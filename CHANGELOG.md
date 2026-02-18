# Changelog

## [0.1.0] - 2026-02-17

Initial working version.

- Photo upload with S3 pre-signed URLs
- Async AI analysis via Worker Lambda (Claude Vision API)
- USDA zone lookup from ZIP code
- Plant matching from AI recommendations against DynamoDB plant database
- Polling-based status updates on frontend
- Three-environment deployment (dev, staging, prod) via CDK
- Structured logging with Pino, shipped to Datadog via Lambda Extension
- CI/CD pipeline with GitHub Actions
