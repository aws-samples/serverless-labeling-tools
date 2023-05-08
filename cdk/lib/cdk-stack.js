/*********************************************************************************************************************
*  Copyright 2023 Amazon.com, Inc. or its affiliates. All Rights Reserved.                                           *
*                                                                                                                    *
*  Licensed under the Amazon Software License (the "License"). You may not use this file except in compliance        *
*  with the License. A copy of the License is located at                                                             *
*                                                                                                                    *
*      http://aws.amazon.com/asl/                                                                                    *
*                                                                                                                    *
*  or in the "license" file accompanying this file. This file is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES *
*  OR CONDITIONS OF ANY KIND, express or implied. See the License for the specific language governing permissions    *
*  and limitations under the License.                                                                                *
**********************************************************************************************************************/

const { Stack, Duration, RemovalPolicy } = require('aws-cdk-lib');
const { AwsCustomResource, AwsCustomResourcePolicy, PhysicalResourceId } = require('aws-cdk-lib/custom-resources');
const { createHash } = require('crypto');
const ec2 = require('aws-cdk-lib/aws-ec2');
const rds = require('aws-cdk-lib/aws-rds');
const lambda = require('aws-cdk-lib/aws-lambda');
const iam = require('aws-cdk-lib/aws-iam');
const s3 = require('aws-cdk-lib/aws-s3');
const elbv2 = require('aws-cdk-lib/aws-elasticloadbalancingv2');
const ecs = require('aws-cdk-lib/aws-ecs');
const ecsPatterns = require('aws-cdk-lib/aws-ecs-patterns');

class CdkStack extends Stack {
  /**
   * Constructor function for this stack.
   * @param {Construct} scope
   * @param {string} id
   * @param {StackProps=} props
   */
  constructor(scope, id, props) {
    super(scope, id, props);

    // Get the current stack object.
    const stack = Stack.of(this);

    // Name of the initial database for the labeling tool. (Some labeling tools don't need it.)
    const dbName = this.node.tryGetContext("DB_NAME");

    // Get VPC and subnet information from cdk.json.
    const vpc = ec2.Vpc.fromLookup(this, 'vpc', { vpcId: this.node.tryGetContext("VPC_ID") });
    const publicSubnets = this.node.tryGetContext("PUBLIC_SUBNET_IDS").map(subnet => ec2.Subnet.fromSubnetId(this, 'public-subnet-' + subnet, subnet));
    const privateSubnets = this.node.tryGetContext("PRIVATE_SUBNET_IDS").map(subnet => ec2.Subnet.fromSubnetId(this, 'private-subnet-' + subnet, subnet));
    const isolatedSubnets = this.node.tryGetContext("ISOLATED_SUBNET_IDS").map(subnet => ec2.Subnet.fromSubnetId(this, 'isolated-subnet-' + subnet, subnet));

    // Create SecurityGroup for the database.
    const dbSecurityGroup = new ec2.SecurityGroup(this, "db-sg", {
      vpc: vpc,
      allowAllOutbound: false
    });

    // Create a secret to be used with RDS database.
    const databaseSecret = new rds.DatabaseSecret(this, 'DatabaseSecret', {
      username: this.node.tryGetContext("DB_USER_NAME")
    });

    // Create the database instance.
    const dbInstance = new rds.DatabaseInstance(this, "db", {
      engine: rds.DatabaseInstanceEngine.postgres({ version: rds.AuroraPostgresEngineVersion.VER_12_9 }),
      vpc: vpc,
      vpcSubnets: {
        subnets: isolatedSubnets
      },
      multiAz: true,
      deletionProtection: true,
      maxAllocatedStorage: this.node.tryGetContext("DB_SIZE"),
      storageEncrypted: true,
      credentials: rds.Credentials.fromSecret(databaseSecret),
      securityGroups: [dbSecurityGroup]
    });

    // Create a SecurityGroup for the database initializer Lambda.
    const dbInitializerSecurityGroup = new ec2.SecurityGroup(this, 'db-initializer-sg', {
      vpc: vpc,
      allowAllOutbound: true
    })

    // Create an IAM role for the database initializer Lambda.
    const dbInitializerRole = new iam.Role(this, 'db-initializer-role', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaVPCAccessExecutionRole')
      ]
    });
    databaseSecret.grantRead(dbInitializerRole)

    // Create the database initializer Lambda from the code location.
    const dbInitializer = new lambda.Function(this, 'db-initializer-func', {
      runtime: lambda.Runtime.NODEJS_16_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('../lambda/db-initializer'),
      functionName: `${id}-ResInit${stack.stackName}`,
      vpc: vpc,
      vpcSubnets: {
        subnets: privateSubnets
      },
      role: dbInitializerRole,
      securityGroups: [dbInitializerSecurityGroup]
    });
    dbSecurityGroup.addIngressRule(dbInitializerSecurityGroup, ec2.Port.tcp(5432))

    // IMPORTANT: the AwsCustomResource construct deploys a singleton AWS Lambda function that is re-used across the same CDK Stack,
    // because it is intended to be re-used, make sure it has permissions to invoke multiple "resource initializer functions" within the same stack and it's timeout is sufficient.
    // @see: https://github.com/aws/aws-cdk/blob/cafe8257b777c2c6f6143553b147873d640c6745/packages/%40aws-cdk/custom-resources/lib/aws-custom-resource/aws-custom-resource.ts#L360
    const customResourceRole = new iam.Role(this, 'custom-resource-role', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com')
    })
    customResourceRole.addToPolicy(
      new iam.PolicyStatement({
        resources: [`arn:${stack.partition}:lambda:${stack.region}:${stack.account}:function:*-ResInit${stack.stackName}`],
        actions: ['lambda:InvokeFunction']
      })
    )

    // Create CDK custom resource and configure the lifecycle events.
    const customResource = new AwsCustomResource(this, 'custom-resource', {
      policy: AwsCustomResourcePolicy.fromSdkCalls({ resources: AwsCustomResourcePolicy.ANY_RESOURCE }),
      onCreate: this.sdkCall({
        secretName: databaseSecret.secretName,
        databaseName: dbName,
        action: 'onCreate'
      }, dbInitializer, id),
      onUpdate: this.sdkCall({
        secretName: databaseSecret.secretName,
        databaseName: dbName,
        action: 'onUpdate'
      }, dbInitializer, id),
      onDelete: this.sdkCall({
        secretName: databaseSecret.secretName,
        databaseName: dbName,
        action: 'onDelete'
      }, dbInitializer, id),
      timeout: Duration.minutes(10),
      role: customResourceRole
    });
    customResource.node.addDependency(dbInstance)

    // Create SecurityGroups for the ECS cluster and the Application Loadbalancer.
    const clusterSecurityGroup = new ec2.SecurityGroup(this, "cluster-sg", {
      vpc: vpc,
      allowAllOutbound: true
    });
    const lbSecurityGroup = new ec2.SecurityGroup(this, "lb-sg", {
      vpc: vpc,
      allowAllOutbound: true
    });
    dbSecurityGroup.addIngressRule(clusterSecurityGroup, ec2.Port.tcp(5432))

    // Create access log bucket for the ALB.
    const albAccessLogBucket = new s3.Bucket(this, 'access-log-bucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: RemovalPolicy.RETAIN,
      enforceSsl: true
    });

    // Create and configure the ALB.
    const loadBalancer = new elbv2.ApplicationLoadBalancer(this, "LB", {
      vpc: vpc,
      vpcSubnets: { 'subnets': publicSubnets },
      internetFacing: true,
      securityGroup: lbSecurityGroup
    })
    loadBalancer.logAccessLogs(albAccessLogBucket, 'access-logs')

    // Create the ECS cluster.
    const cluster = new ecs.Cluster(this, "cluster", {
      vpc: vpc,
      containerInsights: true
    });

    // Create IAM roles for the ECS task creation as well as for task execution.
    const ecsExecutionRole = new iam.Role(this, "ecs-execution-role", {
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
    });
    ecsExecutionRole.attachInlinePolicy(new iam.Policy(this, "policy", {
      statements: [
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            "ecr:GetAuthorizationToken",
            "ecr:BatchCheckLayerAvailability",
            "ecr:GetDownloadUrlForLayer",
            "ecr:BatchGetImage",
            "logs:CreateLogStream",
            "logs:PutLogEvents",
            "logs:CreateLogGroup"
          ],
          resources: ['*']
        })
      ]
    }));
    databaseSecret.grantRead(ecsExecutionRole);

    const ecsTaskRole = new iam.Role(this, "ecs-task-role", {
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
    });
    databaseSecret.grantRead(ecsTaskRole);

    // Create a Fargate based ECS cluster.
    const loadBalancedFargateService = new ecsPatterns.ApplicationLoadBalancedFargateService(this, "Service", {
      cluster: cluster,
      taskSubnets: { 'subnets': privateSubnets },
      memoryLimitMiB: 1024,
      cpu: 512,
      taskImageOptions: {
        image: ecs.ContainerImage.fromAsset('../docker'),
        containerPort: 8000,
        executionRole: ecsExecutionRole,
        taskRole: ecsTaskRole,
        environment: {
          DB_SECRET_NAME: databaseSecret.secretName,
          POSTGRES_HOST: dbInstance.instanceEndpoint.hostname,
          POSTGRES_PORT: dbInstance.instanceEndpoint.port,
          POSTGRES_DB: dbName
        }
      },
      securityGroups: [clusterSecurityGroup],
      assignPublicIp: false,
      loadBalancer: loadBalancer,

      // Optionally add HTTPS if a certificate is available.
      ...(this.node.tryGetContext("CERTIFICATE_ARN") ?
        {
          listenerPort: 443,
          certificate: certificateManager.Certificate.fromCertificateArn(this, "domainCert", this.node.tryGetContext("CERTIFICATE_ARN")),
        } : {})
    });

    // Configure health checks.
    loadBalancedFargateService.targetGroup.configureHealthCheck({
      enabled: true,
      path: "/",
      port: '8000',
      healthyHttpCodes: '200,302'
    });
  }

  /**
   * Helper function to make an AWS SDK call object for Lambda.
   * @param {*} params Payload contents.
   * @param {*} dbInitializer Reference to the database initializer Lambda.
   * @param {*} id The id passed into the Stack.
   * @returns 
   */
  sdkCall(params, dbInitializer, id) {
    const payload = JSON.stringify({
      params
    })
    const payloadHashPrefix = createHash('md5').update(payload).digest('hex').substring(0, 6)

    return {
      service: 'Lambda',
      action: 'invoke',
      parameters: {
        FunctionName: dbInitializer.functionName,
        Payload: payload
      },
      physicalResourceId: PhysicalResourceId.of(`${id}-AwsSdkCall-${dbInitializer.currentVersion.version + payloadHashPrefix}`)
    }
  }
}

module.exports = { CdkStack }
