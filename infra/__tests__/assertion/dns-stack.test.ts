import { describe, expect, it } from 'vitest';
import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { DnsStack } from '../../lib/stacks/dns-stack.js';

describe('DnsStack — shared mode (no stage)', () => {
  const app = new App();
  const stack = new DnsStack(app, 'TestDnsShared', {
    domainName: 'landscaper.cloud',
    env: { account: '111111111111', region: 'us-east-1' },
  });
  const template = Template.fromStack(stack);

  it('creates a public hosted zone', () => {
    template.hasResourceProperties('AWS::Route53::HostedZone', {
      Name: 'landscaper.cloud.',
    });
  });

  it('does not create a certificate', () => {
    template.resourceCountIs('AWS::CertificateManager::Certificate', 0);
  });

  it('exports the HostedZoneId', () => {
    template.hasOutput('HostedZoneId', {
      Export: Match.objectLike({
        Name: 'TestDnsShared-HostedZoneId',
      }),
    });
  });

  it('tags resources with project', () => {
    template.hasResourceProperties('AWS::Route53::HostedZone', {
      HostedZoneTags: Match.arrayWith([
        Match.objectLike({ Key: 'Project', Value: 'LandscapeArchitect' }),
      ]),
    });
  });
});

describe('DnsStack — per-stage dev', () => {
  const app = new App();
  const stack = new DnsStack(app, 'TestDnsDev', {
    stage: 'dev',
    domainName: 'landscaper.cloud',
    hostedZoneId: 'Z1234567890ABC',
    env: { account: '111111111111', region: 'us-east-1' },
  });
  const template = Template.fromStack(stack);

  it('creates a certificate for dev.landscaper.cloud', () => {
    template.hasResourceProperties('AWS::CertificateManager::Certificate', {
      DomainName: 'dev.landscaper.cloud',
      ValidationMethod: 'DNS',
    });
  });

  it('does not create a hosted zone', () => {
    template.resourceCountIs('AWS::Route53::HostedZone', 0);
  });

  it('exports the CertificateArn', () => {
    template.hasOutput('CertificateArn', {
      Export: Match.objectLike({
        Name: 'TestDnsDev-CertificateArn',
      }),
    });
  });
});

describe('DnsStack — per-stage prod', () => {
  const app = new App();
  const stack = new DnsStack(app, 'TestDnsProd', {
    stage: 'prod',
    domainName: 'landscaper.cloud',
    hostedZoneId: 'Z1234567890ABC',
    env: { account: '111111111111', region: 'us-east-1' },
  });
  const template = Template.fromStack(stack);

  it('creates a certificate for the apex domain', () => {
    template.hasResourceProperties('AWS::CertificateManager::Certificate', {
      DomainName: 'landscaper.cloud',
      ValidationMethod: 'DNS',
    });
  });
});

describe('DnsStack — per-stage staging', () => {
  const app = new App();
  const stack = new DnsStack(app, 'TestDnsStaging', {
    stage: 'staging',
    domainName: 'landscaper.cloud',
    hostedZoneId: 'Z1234567890ABC',
    env: { account: '111111111111', region: 'us-east-1' },
  });
  const template = Template.fromStack(stack);

  it('creates a certificate for staging.landscaper.cloud', () => {
    template.hasResourceProperties('AWS::CertificateManager::Certificate', {
      DomainName: 'staging.landscaper.cloud',
      ValidationMethod: 'DNS',
    });
  });
});

describe('DnsStack — error case', () => {
  it('throws when stage is provided without hostedZoneId', () => {
    const app = new App();
    expect(
      () =>
        new DnsStack(app, 'TestDnsError', {
          stage: 'dev',
          domainName: 'landscaper.cloud',
          env: { account: '111111111111', region: 'us-east-1' },
        }),
    ).toThrow('hostedZoneId is required when stage is provided');
  });
});
