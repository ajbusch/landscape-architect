import { CfnOutput, Stack, type StackProps, Tags } from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as route53 from 'aws-cdk-lib/aws-route53';
import type { Construct } from 'constructs';

export interface DnsStackProps extends StackProps {
  domainName: string;
  stage?: string;
  /** Required when stage is provided — the hosted zone ID to use for DNS validation */
  hostedZoneId?: string;
}

export class DnsStack extends Stack {
  public readonly hostedZoneId?: string;
  public readonly certificateArn?: string;
  public readonly domainName?: string;

  constructor(scope: Construct, id: string, props: DnsStackProps) {
    super(scope, id, props);

    if (props.stage) {
      // Per-stage mode: create ACM certificate
      if (!props.hostedZoneId) {
        throw new Error('hostedZoneId is required when stage is provided');
      }

      const stageDomain =
        props.stage === 'prod' ? props.domainName : `${props.stage}.${props.domainName}`;

      const hostedZone = route53.HostedZone.fromHostedZoneAttributes(this, 'ImportedHostedZone', {
        hostedZoneId: props.hostedZoneId,
        zoneName: props.domainName,
      });

      const certificate = new acm.Certificate(this, 'Certificate', {
        domainName: stageDomain,
        validation: acm.CertificateValidation.fromDns(hostedZone),
      });

      this.certificateArn = certificate.certificateArn;
      this.domainName = stageDomain;

      new CfnOutput(this, 'CertificateArn', {
        value: certificate.certificateArn,
        exportName: `${id}-CertificateArn`,
      });

      Tags.of(this).add('Stage', props.stage);
    } else {
      // Shared mode: create hosted zone
      const hostedZone = new route53.PublicHostedZone(this, 'HostedZone', {
        zoneName: props.domainName,
      });

      this.hostedZoneId = hostedZone.hostedZoneId;

      new CfnOutput(this, 'HostedZoneId', {
        value: hostedZone.hostedZoneId,
        exportName: `${id}-HostedZoneId`,
      });
    }

    Tags.of(this).add('Project', 'LandscapeArchitect');
  }
}
