import { Stack, StackProps } from 'aws-cdk-lib';
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2"
import { SubnetType } from 'aws-cdk-lib/aws-ec2';
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as ecs_patterns from "aws-cdk-lib/aws-ecs-patterns";
import * as rds from "aws-cdk-lib/aws-rds";
import * as secretsManager from "aws-cdk-lib/aws-secretsmanager";
import * as ssm from "aws-cdk-lib/aws-ssm";
import { CfnDBSubnetGroup } from 'aws-cdk-lib/aws-rds';
import { Construct } from 'constructs';
import { ELBv2ACMCertificateRequired } from 'cdk-nag/lib/rules/elb';
import { truncate } from 'fs';

export class GeekweekinfraStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);
    
    const serviceName = "geekweek-node";
    const databaseName = "bugbounty";
    const databaseUsername = "geekweek";
    const stage = "dev";

    const vpc = new ec2.Vpc( this, "GWNodeVPC", {
      cidr: "10.0.0.0/16",
      subnetConfiguration: [
        { name: 'elb_public_', subnetType: SubnetType.PUBLIC },
        { name: 'ecs_private_', subnetType: SubnetType.PRIVATE_WITH_NAT },
        { name: 'aurora_isolated_', subnetType: SubnetType.PRIVATE_ISOLATED }
      ]
    });

    const subnetIds: string[] = [];
    vpc.isolatedSubnets.forEach((subnet, index) => {
      subnetIds.push(subnet.subnetId);
    });

    const dbSubnetGroup: rds.CfnDBSubnetGroup = new rds.CfnDBSubnetGroup(this, "AuroraSubnetGroup", {
      dbSubnetGroupDescription: "Subnet group to access Aurora",
      subnetIds: subnetIds,
      dbSubnetGroupName: "aurora-serverless-subnet-group",
    });

    const databaseCredentialsSecret = new secretsManager.Secret(this, 'DBCredentialsSecret', {
      secretName: `${serviceName}-${stage}-credentials`,
      generateSecretString: {
        secretStringTemplate: JSON.stringify({
          username: databaseUsername,
        }),
        excludePunctuation: true,
        includeSpace: false,
        generateStringKey: 'password'
      }
    });

    new ssm.StringParameter(this, 'DBCredentialsArn', {
      parameterName: `${serviceName}-${stage}-credentials-arn`,
      stringValue: databaseCredentialsSecret.secretArn,
    });
    
    const dbClusterSecurityGroup = new ec2.SecurityGroup(this, 'DBClusterSecurityGroup', { vpc });
    dbClusterSecurityGroup.addIngressRule(ec2.Peer.ipv4('10.0.0.0/16'), ec2.Port.tcp(5432));
    
    const dbConfig = {
      dbClusterIdentifier: `${serviceName}-${stage}-cluster`,
      engineMode: 'serverless',
      engine: 'aurora-postgresql',
      engineVersion: '10.7',
      databaseName: databaseName,
      masterUsername: databaseCredentialsSecret.secretValueFromJson('username').toString(),
      masterUserPassword: databaseCredentialsSecret.secretValueFromJson('password').toString(),
      dbSubnetGroupName: dbSubnetGroup.dbSubnetGroupName,
      scalingConfiguration: {
        autoPause: true,
        maxCapacity: 2,
        minCapacity: 2,
        secondsUntilAutoPause: 3600,
      },
      vpcSecurityGroupIds: [
        dbClusterSecurityGroup.securityGroupId
      ]
    };
    
    const rdsCluster = new rds.CfnDBCluster(this, 'DBCluster', dbConfig);
    rdsCluster.addDependsOn(dbSubnetGroup)

    const ecsInitNodeTask = new ecs.FargateTaskDefinition(this, "InitTaskDef", {
      memoryLimitMiB: 512,
      cpu: 256
    });

    const initNodeContainer = ecsInitNodeTask.addContainer("initContainer", {
      image: ecs.ContainerImage.fromRegistry("public.ecr.aws/r7j4v9s7/geekweek-node-init:latest"),
      environment: {
        DB_URL: "super long string I need to build",
      }
    });
    
    const initDependency: ecs.ContainerDependency = {
      container: initNodeContainer,
      condition: ecs.ContainerDependencyCondition.COMPLETE,
    }
    
    const ecsNodeTask = new ecs.FargateTaskDefinition(this, "NodeTaskDef", {
      memoryLimitMiB: 512,
      cpu: 256
    });

    const nodeContainer = ecsNodeTask.addContainer("NodeContainer", {
      image: ecs.ContainerImage.fromRegistry("public.ecr.aws/r7j4v9s7/geekweek-node:latest"),
      environment: {
              DB_HOST: rdsCluster.attrEndpointAddress,
              DB_PORT: "5432",
              DB_NAME: databaseName,
              DB_USER: databaseCredentialsSecret.secretValueFromJson('username').toString(),
              DB_PASS: databaseCredentialsSecret.secretValueFromJson('password').toString(),
           }
    });

    nodeContainer.addPortMappings({
      hostPort: 3000,
      containerPort: 3000
    });

    nodeContainer.addContainerDependencies(initDependency);

    const cluster = new ecs.Cluster(this, "Cluster", { vpc:vpc, });
    const service= new ecs.FargateService(this, "Service", {
      cluster: cluster,
      taskDefinition: ecsNodeTask,
    });

    const lb = new elbv2.ApplicationLoadBalancer(this, "LB", {
      vpc: vpc,
      internetFacing: true,
    });

    const listener = lb.addListener("Listener", { port: 3000, protocol: elbv2.ApplicationProtocol.HTTP, });
    service.registerLoadBalancerTargets(
      {
        containerName:"NodeContainer",
        containerPort: 3000,
        newTargetGroupId: "ECS",
        listener: ecs.ListenerConfig.applicationListener(listener, {
          protocol: elbv2.ApplicationProtocol.HTTP
        }),
      },
    );

    //const cluster = new ecs.Cluster(this, 'Cluster', { vpc });
    //const loadBalancedService = new ecs_patterns.ApplicationLoadBalancedFargateService(this, "FargateService", {
    //  cluster,
    //  taskImageOptions: {
    //    image: ecs.ContainerImage.fromRegistry("public.ecr.aws/r7j4v9s7/geekweek-node:latest"),
    //    environment: {
    //      DATABASE_HOST: rdsCluster.attrEndpointAddress,
    //      DATABASE_NAME: databaseName,
    //      DATABASE_USERNAME: databaseCredentialsSecret.secretValueFromJson('username').toString(),
    //      DATABASE_PASSWORD: databaseCredentialsSecret.secretValueFromJson('password').toString(),
    //    }
    //  },
    //});
 
  }

}
