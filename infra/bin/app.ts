#!/usr/bin/env node
import 'source-map-support/register.js';
import { App } from 'aws-cdk-lib';
import { ApiStack } from '../lib/stacks/api-stack.js';
import { CloudTrailStack } from '../lib/stacks/cloudtrail-stack.js';
import { DatabaseStack } from '../lib/stacks/database-stack.js';
import { FrontendStack } from '../lib/stacks/frontend-stack.js';
import { GitHubOidcStack } from '../lib/stacks/github-oidc-stack.js';
import { NetworkStack } from '../lib/stacks/network-stack.js';
import { StorageStack } from '../lib/stacks/storage-stack.js';

const app = new App();

const stage = (app.node.tryGetContext('stage') as string | undefined) ?? 'dev';

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION ?? 'us-east-1',
};

new NetworkStack(app, `LandscapeArchitect-Network-${stage}`, {
  stage,
  env,
});

new CloudTrailStack(app, `LandscapeArchitect-CloudTrail-${stage}`, {
  stage,
  env,
});

const databaseStack = new DatabaseStack(app, `LandscapeArchitect-Database-${stage}`, {
  stage,
  env,
});

const storageStack = new StorageStack(app, `LandscapeArchitect-Storage-${stage}`, {
  stage,
  env,
});

const apiStack = new ApiStack(app, `LandscapeArchitect-Api-${stage}`, {
  stage,
  env,
});
apiStack.addDependency(databaseStack);
apiStack.addDependency(storageStack);

const frontendStack = new FrontendStack(app, `LandscapeArchitect-Frontend-${stage}`, {
  stage,
  apiUrl: apiStack.apiUrl,
  env,
});
frontendStack.addDependency(apiStack);

new GitHubOidcStack(app, 'LandscapeArchitect-GitHubOidc', {
  repositorySlug: 'ajbusch/landscape-architect',
  env,
});

app.synth();
