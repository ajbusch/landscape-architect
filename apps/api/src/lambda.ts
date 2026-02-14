import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2, Context } from 'aws-lambda';
import { createApp } from './app.js';

let handler:
  | ((event: APIGatewayProxyEventV2, context: Context) => Promise<APIGatewayProxyResultV2>)
  | undefined;

async function bootstrap(): Promise<
  (event: APIGatewayProxyEventV2, context: Context) => Promise<APIGatewayProxyResultV2>
> {
  const awsLambdaFastify = (await import('@fastify/aws-lambda')).default;
  const app = await createApp({ logger: true });
  const proxy = awsLambdaFastify(app);
  await app.ready();
  return proxy;
}

export async function lambdaHandler(
  event: APIGatewayProxyEventV2,
  context: Context,
): Promise<APIGatewayProxyResultV2> {
  handler ??= await bootstrap();
  return handler(event, context);
}
