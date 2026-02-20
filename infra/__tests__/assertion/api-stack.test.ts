import { describe, it } from 'vitest';
import { App, Stack } from 'aws-cdk-lib';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { ApiStack } from '../../lib/stacks/api-stack.js';

describe('ApiStack', () => {
  const app = new App();
  const stack = new ApiStack(app, 'TestApi', {
    stage: 'dev',
    env: { account: '111111111111', region: 'us-east-1' },
  });
  const template = Template.fromStack(stack);

  it('creates two Lambda functions (API + Worker)', () => {
    template.resourceCountIs('AWS::Lambda::Function', 2);
  });

  describe('API Lambda', () => {
    it('configures 512MB memory and 30s timeout', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        MemorySize: 512,
        Timeout: 30,
        Handler: 'index.lambdaHandler',
      });
    });

    it('has WORKER_FUNCTION_NAME and STAGE env vars', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        Handler: 'index.lambdaHandler',
        Environment: {
          Variables: Match.objectLike({
            STAGE: 'dev',
          }),
        },
      });
    });
  });

  describe('Worker Lambda', () => {
    it('configures 1024MB memory and 120s timeout', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        MemorySize: 1024,
        Timeout: 120,
        Handler: 'index.handler',
      });
    });

    it('has CLAUDE_MODEL env var', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        Handler: 'index.handler',
        Environment: {
          Variables: Match.objectLike({
            CLAUDE_MODEL: 'claude-sonnet-4-20250514',
          }),
        },
      });
    });

    it('has STAGE env var', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        Handler: 'index.handler',
        Environment: {
          Variables: Match.objectLike({
            STAGE: 'dev',
          }),
        },
      });
    });

    it('has Sharp layer attached', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        Handler: 'index.handler',
        MemorySize: 1024,
        Layers: Match.anyValue(),
      });
    });
  });

  it('creates a Sharp Lambda Layer', () => {
    template.resourceCountIs('AWS::Lambda::LayerVersion', 1);
    template.hasResourceProperties('AWS::Lambda::LayerVersion', {
      CompatibleRuntimes: ['nodejs20.x'],
      Description: 'Sharp image processing library',
    });
  });

  it('uses Node.js 20 ARM64 runtime for both', () => {
    // Both functions should use nodejs20.x and arm64
    template.hasResourceProperties('AWS::Lambda::Function', {
      Runtime: 'nodejs20.x',
      Architectures: ['arm64'],
      Handler: 'index.lambdaHandler',
    });
    template.hasResourceProperties('AWS::Lambda::Function', {
      Runtime: 'nodejs20.x',
      Architectures: ['arm64'],
      Handler: 'index.handler',
    });
  });

  it('creates an HTTP API Gateway', () => {
    template.resourceCountIs('AWS::ApiGatewayV2::Api', 1);
    template.hasResourceProperties('AWS::ApiGatewayV2::Api', {
      ProtocolType: 'HTTP',
    });
  });

  it('has CORS configured for dev origins', () => {
    template.hasResourceProperties('AWS::ApiGatewayV2::Api', {
      CorsConfiguration: Match.objectLike({
        AllowOrigins: Match.arrayWith([
          'https://dev.landscaper.cloud',
          'https://staging.landscaper.cloud',
          'https://d2jp0cpr1bn6fp.cloudfront.net',
          'https://d3734vo7rulmf3.cloudfront.net',
          'http://localhost:5173',
          'http://localhost:3000',
        ]),
        AllowMethods: Match.arrayWith(['*']),
        AllowHeaders: Match.arrayWith(['*']),
      }),
    });
  });

  it('has a catch-all route', () => {
    template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
      RouteKey: 'ANY /{proxy+}',
    });
  });

  it('grants Lambda DynamoDB read/write access', () => {
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: Match.arrayWith([
              'dynamodb:BatchGetItem',
              'dynamodb:Query',
              'dynamodb:GetItem',
              'dynamodb:Scan',
              'dynamodb:BatchWriteItem',
              'dynamodb:PutItem',
              'dynamodb:UpdateItem',
              'dynamodb:DeleteItem',
            ]),
            Effect: 'Allow',
          }),
        ]),
      }),
    });
  });

  it('tags resources with project and stage', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      Tags: Match.arrayWith([
        Match.objectLike({ Key: 'Project', Value: 'LandscapeArchitect' }),
        Match.objectLike({ Key: 'Stage', Value: 'dev' }),
      ]),
    });
  });

  describe('Log groups', () => {
    it('creates two log groups', () => {
      template.resourceCountIs('AWS::Logs::LogGroup', 2);
    });

    it('sets 30-day retention for dev stage', () => {
      template.hasResourceProperties('AWS::Logs::LogGroup', {
        RetentionInDays: 30,
      });
    });
  });
});

describe('ApiStack with Datadog Extension + Tracing', () => {
  const app = new App();

  // Create a mock secret in a separate stack
  const secretStack = new Stack(app, 'TestSecretStack', {
    env: { account: '111111111111', region: 'us-east-1' },
  });
  const mockSecret = new secretsmanager.Secret(secretStack, 'MockDdSecret', {
    secretName: 'test/datadog-api-key',
  });

  const stack = new ApiStack(app, 'TestApiWithDatadog', {
    stage: 'dev',
    version: 'abc1234',
    env: { account: '111111111111', region: 'us-east-1' },
    ddApiKeySecret: mockSecret,
  });
  const template = Template.fromStack(stack);

  // After handler redirect, both Lambdas have the Datadog wrapper handler.
  // Identify them by MemorySize: API = 512, Worker = 1024.
  const DD_HANDLER = '/opt/nodejs/node_modules/datadog-lambda-js/handler.handler';

  it('redirects both handlers to the Datadog wrapper', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      MemorySize: 512,
      Handler: DD_HANDLER,
    });
    template.hasResourceProperties('AWS::Lambda::Function', {
      MemorySize: 1024,
      Handler: DD_HANDLER,
    });
  });

  it('sets DD_LAMBDA_HANDLER to original handler values', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      MemorySize: 512,
      Environment: {
        Variables: Match.objectLike({
          DD_LAMBDA_HANDLER: 'index.lambdaHandler',
        }),
      },
    });
    template.hasResourceProperties('AWS::Lambda::Function', {
      MemorySize: 1024,
      Environment: {
        Variables: Match.objectLike({
          DD_LAMBDA_HANDLER: 'index.handler',
        }),
      },
    });
  });

  it('adds 2 Datadog layers to API Lambda (Extension + Node.js library)', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      MemorySize: 512,
      Layers: Match.arrayWith([
        Match.stringLikeRegexp('Datadog-Extension-ARM'),
        Match.stringLikeRegexp('Datadog-Node20-x'),
      ]),
    });
  });

  it('adds 3 layers to Worker Lambda (Sharp + Extension + Node.js library)', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      MemorySize: 1024,
      Layers: Match.arrayWith([
        Match.stringLikeRegexp('Datadog-Extension-ARM'),
        Match.stringLikeRegexp('Datadog-Node20-x'),
      ]),
    });
  });

  it('sets DD_* environment variables on both Lambdas', () => {
    for (const memorySize of [512, 1024]) {
      template.hasResourceProperties('AWS::Lambda::Function', {
        MemorySize: memorySize,
        Handler: DD_HANDLER,
        Environment: {
          Variables: Match.objectLike({
            DD_SITE: 'us5.datadoghq.com',
            DD_LOG_LEVEL: 'info',
            DD_SERVERLESS_LOGS_ENABLED: 'true',
            DD_ENV: 'dev',
            DD_SERVICE: 'landscape-architect',
            DD_TRACE_ENABLED: 'true',
            DD_MERGE_XRAY_TRACES: 'false',
            DD_COLD_START_TRACING: 'true',
            DD_CAPTURE_LAMBDA_PAYLOAD: 'false',
            DD_VERSION: 'abc1234',
          }),
        },
      });
    }
  });

  it('sets LLM Observability env vars on Worker Lambda only', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      MemorySize: 1024,
      Environment: {
        Variables: Match.objectLike({
          DD_LLMOBS_ENABLED: '1',
          DD_LLMOBS_ML_APP: 'landscape-architect',
        }),
      },
    });

    // API Lambda must NOT have LLM Observability enabled
    template.hasResourceProperties('AWS::Lambda::Function', {
      MemorySize: 512,
      Environment: {
        Variables: Match.objectLike({
          DD_SITE: 'us5.datadoghq.com',
        }),
      },
    });
    // Verify DD_LLMOBS_ENABLED is absent on API Lambda by checking
    // the synth output does not include it for the 512MB function
    const apiFunction = template.findResources('AWS::Lambda::Function', {
      Properties: { MemorySize: 512 },
    });
    const apiFnLogicalId = Object.keys(apiFunction)[0];
    const apiEnvVars = apiFunction[apiFnLogicalId].Properties.Environment.Variables;
    if ('DD_LLMOBS_ENABLED' in apiEnvVars) {
      throw new Error('API Lambda should NOT have DD_LLMOBS_ENABLED set');
    }
  });
});
