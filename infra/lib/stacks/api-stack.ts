import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CfnOutput, Duration, Fn, RemovalPolicy, Stack, type StackProps, Tags } from 'aws-cdk-lib';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
import * as apigateway from 'aws-cdk-lib/aws-apigatewayv2';
import * as integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import type { Construct } from 'constructs';

export interface ApiStackProps extends StackProps {
  stage: string;
  version?: string;
  ddApiKeySecret?: secretsmanager.ISecret;
}

export class ApiStack extends Stack {
  public readonly apiUrl: string;
  public readonly apiLambda: lambda.Function;
  public readonly workerLambda: lambda.Function;

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

    // ── Explicit log groups with retention ──────────────────────────
    const apiLogGroup = new logs.LogGroup(this, 'ApiLogGroup', {
      retention:
        props.stage === 'prod' ? logs.RetentionDays.THREE_MONTHS : logs.RetentionDays.ONE_MONTH,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const workerLogGroup = new logs.LogGroup(this, 'WorkerLogGroup', {
      retention:
        props.stage === 'prod' ? logs.RetentionDays.THREE_MONTHS : logs.RetentionDays.ONE_MONTH,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // ── Sharp Lambda Layer (pre-built native binaries for ARM64) ──
    // Run `bash infra/layers/sharp/build.sh` before cdk synth/deploy to populate nodejs/
    const sharpLayer = new lambda.LayerVersion(this, 'SharpLayer', {
      code: lambda.Code.fromAsset(path.join(__dirname, '../../layers/sharp')),
      compatibleRuntimes: [lambda.Runtime.NODEJS_20_X],
      compatibleArchitectures: [lambda.Architecture.ARM_64],
      description: 'Sharp image processing library',
    });

    // ── Worker Lambda (heavy processing: Sharp, Claude Vision, plant matching) ──
    const workerFn = new nodejs.NodejsFunction(this, 'WorkerFunction', {
      entry: '../apps/api/src/worker.ts',
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      timeout: Duration.seconds(120),
      memorySize: 1024,
      layers: [sharpLayer],
      logGroup: workerLogGroup,
      bundling: {
        format: nodejs.OutputFormat.CJS,
        target: 'node20',
        externalModules: ['@aws-sdk/*', 'sharp', 'datadog-lambda-js', 'dd-trace'],
      },
      environment: {
        TABLE_NAME: tableName,
        BUCKET_NAME: bucketName,
        SECRET_ARN: secretArn,
        CLAUDE_MODEL: 'claude-sonnet-4-20250514',
        STAGE: props.stage,
        NODE_OPTIONS: '--enable-source-maps',
      },
    });

    bucket.grantRead(workerFn);
    table.grantReadWriteData(workerFn);
    secret.grantRead(workerFn);

    // ── API Lambda (lightweight: validation, DynamoDB read/write, invoke worker) ──
    const apiFn = new nodejs.NodejsFunction(this, 'ApiFunction', {
      entry: '../apps/api/src/lambda.ts',
      handler: 'lambdaHandler',
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      timeout: Duration.seconds(30),
      memorySize: 512,
      logGroup: apiLogGroup,
      bundling: {
        format: nodejs.OutputFormat.CJS,
        target: 'node20',
        externalModules: ['@aws-sdk/*', 'sharp', 'datadog-lambda-js', 'dd-trace'],
      },
      environment: {
        TABLE_NAME: tableName,
        BUCKET_NAME: bucketName,
        STAGE: props.stage,
        WORKER_FUNCTION_NAME: workerFn.functionName,
        NODE_OPTIONS: '--enable-source-maps',
      },
    });

    table.grantReadWriteData(apiFn);
    bucket.grantReadWrite(apiFn);
    workerFn.grantInvoke(apiFn);

    this.apiLambda = apiFn;
    this.workerLambda = workerFn;

    // ── Datadog Extension + Tracing (gated on API key secret) ────────
    if (props.ddApiKeySecret) {
      const region = Stack.of(this).region;

      // Extension layer (ARM variant — contains Go binary)
      const datadogExtension = lambda.LayerVersion.fromLayerVersionArn(
        this,
        'DatadogExtension',
        `arn:aws:lambda:${region}:464622532012:layer:Datadog-Extension-ARM:65`,
      );

      // Node.js library layer (multi-arch — contains datadog-lambda-js + dd-trace)
      const datadogNodeLib = lambda.LayerVersion.fromLayerVersionArn(
        this,
        'DatadogNodeLib',
        `arn:aws:lambda:${region}:464622532012:layer:Datadog-Node20-x:133`,
      );

      for (const fn of [apiFn, workerFn]) {
        fn.addLayers(datadogExtension, datadogNodeLib);
        fn.addEnvironment('DD_API_KEY_SECRET_ARN', props.ddApiKeySecret.secretArn);
        fn.addEnvironment('DD_SITE', 'us5.datadoghq.com');
        fn.addEnvironment('DD_LOG_LEVEL', 'info');
        fn.addEnvironment('DD_SERVERLESS_LOGS_ENABLED', 'true');
        fn.addEnvironment('DD_ENV', props.stage);
        fn.addEnvironment('DD_SERVICE', 'landscape-architect');
        fn.addEnvironment('DD_TRACE_ENABLED', 'true');
        fn.addEnvironment('DD_MERGE_XRAY_TRACES', 'false');
        fn.addEnvironment('DD_COLD_START_TRACING', 'true');
        fn.addEnvironment('DD_CAPTURE_LAMBDA_PAYLOAD', 'false');
        fn.addEnvironment('DD_VERSION', props.version ?? 'unset');
        props.ddApiKeySecret.grantRead(fn);
      }

      // Handler redirect — Datadog wrapper imports the original handler via DD_LAMBDA_HANDLER
      for (const { fn, originalHandler } of [
        { fn: apiFn, originalHandler: 'index.lambdaHandler' },
        { fn: workerFn, originalHandler: 'index.handler' },
      ]) {
        fn.addEnvironment('DD_LAMBDA_HANDLER', originalHandler);
        // Override handler at L1 (CfnFunction) level — this is a CDK escape hatch.
        // The official alternative is datadog-cdk-constructs-v2 which handles this
        // automatically, but it's heavier. This approach is fine for 2 functions.
        const cfnFn = fn.node.defaultChild as lambda.CfnFunction;
        cfnFn.handler = '/opt/nodejs/node_modules/datadog-lambda-js/handler.handler';
      }

      // ── LLM Observability (Worker only — it's the only function that calls Claude) ──
      workerFn.addEnvironment('DD_LLMOBS_ENABLED', 'true');
      workerFn.addEnvironment('DD_LLMOBS_ML_APP', 'landscape-architect');
    }

    const isProd = props.stage === 'prod';

    const apiCorsOrigins = isProd
      ? [
          'https://landscapearchitect.app',
          'https://landscaper.cloud',
          'https://d5hj1rpwk1mpl.cloudfront.net',
        ]
      : [
          'https://dev.landscaper.cloud',
          'https://staging.landscaper.cloud',
          'https://d2jp0cpr1bn6fp.cloudfront.net',
          'https://d3734vo7rulmf3.cloudfront.net',
          'http://localhost:5173',
          'http://localhost:3000',
        ];

    const httpApi = new apigateway.HttpApi(this, 'HttpApi', {
      apiName: `LandscapeArchitect-Api-${props.stage}`,
      corsPreflight: {
        allowOrigins: apiCorsOrigins,
        allowMethods: [apigateway.CorsHttpMethod.ANY],
        allowHeaders: ['*'],
      },
    });

    httpApi.addRoutes({
      path: '/{proxy+}',
      methods: [apigateway.HttpMethod.ANY],
      integration: new integrations.HttpLambdaIntegration('LambdaIntegration', apiFn),
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
