import { describe, it, expect } from 'vitest';
import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { NetworkStack } from '../../lib/stacks/network-stack.js';

describe('NetworkStack', () => {
  describe('dev stage', () => {
    const app = new App();
    const stack = new NetworkStack(app, 'TestNetworkDev', {
      stage: 'dev',
      env: { account: '111111111111', region: 'us-east-1' },
    });
    const template = Template.fromStack(stack);

    it('creates a VPC', () => {
      template.resourceCountIs('AWS::EC2::VPC', 1);
    });

    it('creates exactly 1 NAT gateway in dev', () => {
      template.resourceCountIs('AWS::EC2::NatGateway', 1);
    });

    it('tags resources with project and stage', () => {
      template.hasResourceProperties('AWS::EC2::VPC', {
        Tags: Match.arrayWith([
          Match.objectLike({ Key: 'Project', Value: 'LandscapeArchitect' }),
          Match.objectLike({ Key: 'Stage', Value: 'dev' }),
        ]),
      });
    });
  });

  describe('prod stage', () => {
    const app = new App();
    const stack = new NetworkStack(app, 'TestNetworkProd', {
      stage: 'prod',
      env: { account: '333333333333', region: 'us-east-1' },
    });
    const template = Template.fromStack(stack);

    it('creates 2 NAT gateways in prod', () => {
      template.resourceCountIs('AWS::EC2::NatGateway', 2);
    });
  });
});
