import pino from 'pino';

export const logger = pino({
  base: {
    service: 'landscape-architect',
    stage: process.env.STAGE,
    lambda: process.env.AWS_LAMBDA_FUNCTION_NAME,
  },
  formatters: {
    level(label) {
      return { level: label };
    },
  },
});
