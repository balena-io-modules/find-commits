#!/usr/bin/env node

'use strict'

const capitano = require('capitano')
const _ = require('lodash')
const octokit = require('@octokit/rest')({
  debug: !!process.env.DEBUG,
  auth: process.env.GITHUB_TOKEN
})
const commitParser = require('resin-commit-linter/lib/parser').parse

const paginate = (options) => {
  const {
    requestFn,
    args
  } = options

  const requestOptions = requestFn.endpoint.merge(args)
  return octokit.paginate(requestOptions)
}

capitano.command({
  signature: 'sha',
  options: [{
    signature: 'repo',
    parameter: 'repo',
    required: true,
    alias: ['r'],
    description: 'Head repository name',
  }, {
    signature: 'owner',
    parameter: 'owner',
    required: true,
    alias: ['o'],
    description: 'Head owner name',
  }, {
    signature: 'number',
    parameter: 'number',
    required: true,
    alias: ['n'],
    description: 'PR number',
  }],
  action: async (params, options) => {
    const owner = options['owner']
    const repo = options['repo']
    const number = options['number']

    const commits = await octokit.pullRequests.getCommits({
      owner,
      repo,
      number
    })
    const shas = commits.data.reduce((acc, commit) => {
      if (commit.parents && commit.parents.length > 1) {
        return acc
      }
      acc.push(commit.sha)
      return acc
    }, [])
    for (const sha of shas) {
      console.log(sha)
    }
  }
})

capitano.command({
  signature: 'parsed',
  options: [{
    signature: 'repo',
    parameter: 'repo',
    required: true,
    alias: ['r'],
    description: 'Head repository name',
  }, {
    signature: 'owner',
    parameter: 'owner',
    required: true,
    alias: ['o'],
    description: 'Head owner name',
  }, {
    signature: 'number',
    parameter: 'number',
    required: true,
    alias: ['n'],
    description: 'PR number',
  }],
  action: async (params, options) => {
    const owner = options['owner']
    const repo = options['repo']
    const number = options['number']

    const commits = await octokit.pullRequests.getCommits({
      owner,
      repo,
      number
    })

    const parsed = commits.data.reduce((acc, commit) => {
      if (commit.parents && commit.parents.length > 1) {
        return acc
      }
      acc.push(commitParser(commit.commit.message))
      return acc
    }, [])

    console.log(JSON.stringify(parsed, null, 2))
  }
})

capitano.command({
  signature: 'candidate',
  options: [{
    signature: 'repo',
    parameter: 'repo',
    required: true,
    alias: ['r'],
    description: 'Head repository name',
  }, {
    signature: 'owner',
    parameter: 'owner',
    required: true,
    alias: ['o'],
    description: 'Head owner name',
  }],
  action: async (params, options) => {

    const owner = options['owner']
    const repo = options['repo']
    const number = options['number']

    const candidate = await findPRcandidates(repo, owner)

    console.log(JSON.stringify(candidate, null, 2))
  }
})

capitano.run(process.argv, err => {
  if (err != null) {
    throw err
  }
})

const findPRcandidates = async (repo, owner) => {
  let prs = await paginate({
    requestFn: octokit.pulls.list,
    args: {
      owner,
      repo,
      state: 'opened'
    }
  })
  let fullPRs = await gatherFullPRsInfo(prs, repo, owner)

  const mergeablePRs = await getMergablePRs(fullPRs, repo, owner)
  // We want to take a random PR out of the list of available ones
  // to prevent any bias on the selection
  return _.sample(mergeablePRs)

}

const gatherFullPRsInfo = async (prs, repo, owner) => {
  const result = []
  for (const pr of prs) {
    const fullPR = await octokit.pulls.get({
      owner,
      repo,
      pull_number: pr.number
    })
    result.push(fullPR)
  }
  return result
}

const getMergablePRs = async (prs, repo, owner) => {
  const result = []
  for (const pr of prs) {
    const rebaseable = pr.data.rebaseable
    const approved = await isApproved(pr, owner, repo)
    const isGreen = await allChecksPassed(pr, owner, repo)
    const isNotFork = pr.data.head.repo.full_name === pr.data.base.repo.full_name
    if (rebaseable && approved && isGreen && isNotFork) {
      result.push(pr)
    }
  }
  return result
}

const isApproved = async (pr, owner, repo) => {
  // fetch reviews
  const reviews = await paginate({
    requestFn: octokit.pulls.listReviews,
    args: {
      owner,
      repo,
      pull_number: pr.data.number
    }
  })
  // fetch codeowners
  const codeowners = await fetchCodeowners(owner, repo)
  // fetch repo settings
  // check that # of approved reviews from codeowner satisfies checking
  // At least 1 of the requestedCodeowners that are requested for review has approved
  if (!_.isEmpty(codeowners)) {
    return _.some(codeowners, (owner) => {
      return _.find(reviews, (review) => {
        return review.user.login.toLowerCase() == owner.toLowerCase()
          && review.state === 'APPROVED'
      })
    })
  }
  return _.some(reviews, (review, idx) => {
    return review.state === 'APPROVED' && !_.find(reviews.slice(idx), (successiveReview) => {
      return successiveReview.user.login === review.user.login && successiveReview.state != 'APPROVED'
    })
  })
}

const allChecksPassed = async (pr, owner, repo) => {
  const branchProtection = await octokit.repos.getBranchProtection({
    owner,
    repo,
    branch: pr.data.base.ref
  })

  const statuses = await octokit.repos.getCombinedStatusForRef({
    owner,
    repo,
    ref: pr.data.head.sha
  })

  const checks = await paginate({
    requestFn: octokit.checks.listForRef,
    args: {
      owner,
      repo,
      ref: pr.data.head.sha
    }
  })

  const checksAndStatuses = _.concat(statuses.data.statuses, _.map(checks, (check) => {
    // Github renames fields between checks and statuses
    return {
      context: check.name,
      state: check.conclusion
    }
  }))

  return _.every(branchProtection.data.required_status_checks.contexts, (requiredCheck) => {
    return _.find(checksAndStatuses, (status) => {
      return requiredCheck === status.context && status.state === "success"
    })
  })
}

const fetchCodeowners = async (owner, repo) => {
  const get = tryFetchFromRepo(owner, repo)
  return Promise.all([
    get('CODEOWNERS'),
    get('docs/CODEOWNERS'),
    get('.github/CODEOWNERS')
  ])
  .then((results) => {
    return _.compact(_.uniq(_.flatten(results)))
  })
}

const tryFetchFromRepo = (owner, repo) => (path) => {
  return octokit.repos.getContents({
    owner,
    repo,
    path
  })
  .catch((e) => {
    if (e.status != 404) {
      throw e
    }
  })
  .then((result) => {
    if (result && result.data && result.data.type === "file") {
      const contents = Buffer.from(result.data.content, result.data.encoding).toString()
      return parseCodeownersFiles(contents)
    }
  })
}

const parseCodeownersFiles = (codeowners) => {
  const GITHUB_USERNAME_REGEXP = '[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}'
  const matches = (new RegExp(`@(${GITHUB_USERNAME_REGEXP})`, 'gi'))
  // we are parsing the '@' before usernames as well, so we must drop it before returning the list
  return codeowners.match(matches).map((username) => username.slice(1))
}
