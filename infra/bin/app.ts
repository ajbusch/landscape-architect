#!/usr/bin/env node
import 'source-map-support/register.js';
import { App } from 'aws-cdk-lib';
import { NetworkStack } from '../lib/stacks/network-stack.js';

const app = new App();

const stage = (app.node.tryGetContext('stage') as string | undefined) ?? 'dev';

new NetworkStack(app, `LandscapeArchitect-Network-${stage}`, {
  stage,
  env: {
    account: process.env['CDK_DEFAULT_ACCOUNT'],
    region: process.env['CDK_DEFAULT_REGION'] ?? 'us-east-1',
  },
});

app.synth();
