import { CfnOutput, Duration, Fn, Stack, type StackProps, Tags } from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigatewayv2';
import * as integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import type { Construct } from 'constructs';

export interface ApiStackProps extends StackProps {
  stage: string;
}

export class ApiStack extends Stack {
  public readonly apiUrl: string;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    const tableName = Fn.importValue(`LandscapeArchitect-Database-${props.stage}-TableName`);
    const bucketName = Fn.importValue(`LandscapeArchitect-Storage-${props.stage}-PhotoBucketName`);
    const secretArn = Fn.importValue(
      `LandscapeArchitect-Storage-${props.stage}-AnthropicApiKeySecretArn`,
    );

    const table = dynamodb.Table.fromTableName(this, 'ImportedTable', tableName);
    const bucket = s3.Bucket.fromBucketName(this, 'ImportedBucket', bucketName);
    const secret = secretsmanager.Secret.fromSecretCompleteArn(this, 'ImportedSecret', secretArn);

    const fn = new nodejs.NodejsFunction(this, 'ApiFunction', {
      entry: '../apps/api/src/lambda.ts',
      handler: 'lambdaHandler',
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      timeout: Duration.seconds(30),
      memorySize: 512,
      bundling: {
        format: nodejs.OutputFormat.ESM,
        target: 'node20',
        mainFields: ['module', 'main'],
        externalModules: ['@aws-sdk/*', 'sharp'],
        banner:
          "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
      },
      environment: {
        TABLE_NAME: tableName,
        BUCKET_NAME: bucketName,
        SECRET_ARN: secretArn,
        STAGE: props.stage,
        CLAUDE_MODEL: 'claude-sonnet-4-20250514',
        NODE_OPTIONS: '--enable-source-maps',
      },
    });

    table.grantReadWriteData(fn);
    bucket.grantReadWrite(fn);
    secret.grantRead(fn);

    const httpApi = new apigateway.HttpApi(this, 'HttpApi', {
      apiName: `LandscapeArchitect-Api-${props.stage}`,
      corsPreflight: {
        allowOrigins: [
          props.stage === 'prod' ? 'https://landscapearchitect.app' : 'http://localhost:5173',
        ],
        allowMethods: [apigateway.CorsHttpMethod.ANY],
        allowHeaders: ['*'],
      },
    });

    httpApi.addRoutes({
      path: '/{proxy+}',
      methods: [apigateway.HttpMethod.ANY],
      integration: new integrations.HttpLambdaIntegration('LambdaIntegration', fn),
    });

    const apiUrl = httpApi.url ?? '';
    this.apiUrl = apiUrl;

    new CfnOutput(this, 'ApiUrl', {
      value: apiUrl,
      description: 'URL of the HTTP API Gateway',
    });

    Tags.of(this).add('Project', 'LandscapeArchitect');
    Tags.of(this).add('Stage', props.stage);
  }
}
