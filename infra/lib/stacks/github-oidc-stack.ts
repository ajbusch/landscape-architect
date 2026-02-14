import { CfnOutput, Duration, Stack, type StackProps, Tags } from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import type { Construct } from 'constructs';

export interface GitHubOidcStackProps extends StackProps {
  repositorySlug: string;
}

export class GitHubOidcStack extends Stack {
  public readonly deployRole: iam.IRole;

  constructor(scope: Construct, id: string, props: GitHubOidcStackProps) {
    super(scope, id, props);

    const provider = iam.OpenIdConnectProvider.fromOpenIdConnectProviderArn(
      this,
      'GitHubOidcProvider',
      `arn:aws:iam::${this.account}:oidc-provider/token.actions.githubusercontent.com`,
    );

    const deployRole = new iam.Role(this, 'DeployRole', {
      assumedBy: new iam.OpenIdConnectPrincipal(provider, {
        StringLike: {
          'token.actions.githubusercontent.com:sub': `repo:${props.repositorySlug}:*`,
        },
      }),
      maxSessionDuration: Duration.hours(1),
    });

    deployRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['cloudformation:*'],
        resources: ['*'],
      }),
    );

    deployRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['s3:*'],
        resources: ['*'],
      }),
    );

    deployRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['lambda:*'],
        resources: ['*'],
      }),
    );

    deployRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['apigateway:*'],
        resources: ['*'],
      }),
    );

    deployRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'iam:GetRole',
          'iam:CreateRole',
          'iam:DeleteRole',
          'iam:AttachRolePolicy',
          'iam:DetachRolePolicy',
          'iam:PutRolePolicy',
          'iam:DeleteRolePolicy',
          'iam:PassRole',
          'iam:TagRole',
          'iam:UntagRole',
          'iam:UpdateAssumeRolePolicy',
          'iam:GetRolePolicy',
          'iam:ListRolePolicies',
          'iam:ListAttachedRolePolicies',
        ],
        resources: [
          'arn:aws:iam::*:role/LandscapeArchitect-*',
          'arn:aws:iam::*:role/cdk-*',
        ],
      }),
    );

    deployRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['cloudfront:*'],
        resources: ['*'],
      }),
    );

    deployRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['cognito-idp:*', 'cognito-identity:*'],
        resources: ['*'],
      }),
    );

    deployRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['ssm:GetParameter'],
        resources: ['*'],
      }),
    );

    deployRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['sts:AssumeRole'],
        resources: ['arn:aws:iam::*:role/cdk-*'],
      }),
    );

    deployRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['ec2:Describe*'],
        resources: ['*'],
      }),
    );

    deployRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['cloudtrail:*'],
        resources: ['*'],
      }),
    );

    deployRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['logs:*'],
        resources: ['*'],
      }),
    );

    this.deployRole = deployRole;

    new CfnOutput(this, 'DeployRoleArn', {
      value: deployRole.roleArn,
      description: 'ARN of the GitHub Actions deploy role',
    });

    Tags.of(this).add('Project', 'LandscapeArchitect');
  }
}
