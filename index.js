#!/usr/bin/env node

'use strict'

const capitano = require('capitano')
const _ = require('lodash')
const { Octokit } = require('@octokit/rest')
const octokit = new Octokit({
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

const fetchCommits = (owner, repo, number) => {
  return paginate({
    requestFn: octokit.pulls.listCommits,
    args: {
      owner,
      repo,
      pull_number: number
    }
  })
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

    const commits = await fetchCommits(owner, repo, number)
    const shas = commits.reduce((acc, commit) => {
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

    const commits = await fetchCommits(owner, repo, number)

    const parsed = commits.reduce((acc, commit) => {
      if (commit.parents && commit.parents.length > 1) {
        return acc
      }
      acc.push(commitParser(commit.commit.message))
      return acc
    }, [])

    console.log(JSON.stringify(parsed, null, 2))
  }
})

capitano.run(process.argv, err => {
  if (err != null) {
    throw err
  }
})
