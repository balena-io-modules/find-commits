#!/usr/bin/env node

'use strict'

const capitano = require('capitano')
const octokit = require('@octokit/rest')({
  debug: !!process.env.DEBUG
})

octokit.authenticate({ type: 'token', token: process.env.GITHUB_TOKEN })

capitano.command({
  signature: 'pr',
  options: [{
    signature: 'repo',
    parameter: 'repo',
    required: true,
    description: 'Head repository name',
  }, {
    signature: 'owner',
    parameter: 'owner',
    required: true,
    description: 'Head owner name',
  }, {
    signature: 'number',
    parameter: 'number',
    required: true,
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
    const shas = commits.data.map((commit) => {
      return commit.sha
    })
    for (const sha of shas) {
      console.log(sha)
    }
  }
})


capitano.run(process.argv, err => {
  if (err != null) {
    throw err
  }
})
