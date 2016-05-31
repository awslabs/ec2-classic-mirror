# Overview

ClassicMirror is automation that helps manage the migration of an
application from EC2-Classic to a VPC.  It runs as a Lambda function in
your AWS account, monitoring changes to EC2-Classic resources that you
have tagged and managing up-to-date mirrors of them in your VPC.

In a nutshell, this is what a running ClassicMirror does for you.
You: Tag one or more EC2-Classic Security Groups with key
classicmirror:linkToVPC, value=$yourVpcId.
ClassicMirror:
* Ensures that a Security Group of the same name exists in the VPC that you designated.
* Does a one-way sync of your EC2-Classic Security Group rules to the
corresponding VPC Security Group that it created.  In other words, if you
change the rules in your EC2-Classic Security Group, ClassicMirror will
mirror those rules in the VPC Security Group.
* For any EC2-Classic instances that are a member of your tagged
EC2-Classic Security Group(s), they will be ClassicLinked into the
corresponding VPC Security Group(s) in the VPC.

# Try ClassicMirror

The best way to learn about it is to see it in action.  Follow the setup
steps below to deploy ClassicMirror in your account.

## Prerequisites

ClassicMirror works in regions that support both ClassicLink and Lambda:
ap-northeast-1, eu-west-1, us-west-1, and us-west-2.

You will need the following in order to deploy ClassicMirror.
* The AWS CLI (command-line interface) is installed and configured to use the region in which you intend to deploy ClassicMirror.
* CloudTrail logging is enabled in that region.  To enable CloudTrail, visit the AWS CloudTrail console.
* You have read-write access to an S3 bucket in the same region you wish to deploy ClassicMirror.  That S3 bucket name should look like "$S3_BUCKET_BASE_NAME"-"$AWS_REGION", for example my-classicmirror-bucket-eu-west-1.

## Deploying ClassicMirror

First you will install the dependencies and create a zip file containing
the Lambda function code.  This package includes a helper script,
lambda_upload.sh, that will zip up the code and its dependencies, and then
upload them to an appropriate S3 bucket.

```bash
npm install && \
./tools/lambda_upload.sh [-p $OPTIONAL_PREFIX] [-r $AWS_REGION]
$S3_BUCKET_BASE_NAME .
```

If you specified a prefix, for example `-p foo`, this would create a zip
archive of the Lambda code at
s3://$S3_BUCKET_BUCKET_BASE_NAME-$AWS_REGION/foo/classicmirror-$DATESTAMP.zip

Then you will create a Lambda function to run that code.  You can use the
CloudFormation template included in this package to create the Lambda
with all necessary permissions and point it to your zip file in S3.

```bash
aws cloudformation create-stack --stack-name ClassicMirrorLambda \
   --region $AWS_REGION \
   --capabilities CAPABILITY_IAM \
   --template-body file://$(realpath ./cloudformation/classicmirror_lambda_template.json) \
   --parameters ParameterKey=LambdaFunctionS3BucketBase,ParameterValue=$S3_BUCKET_BASE_NAME \
     ParameterKey=LambdaFunctionS3Key,ParameterValue=$S3_KEY
```

In the above example, S3_KEY would be the foo/classicmirror-$DATESTAMP.zip
S3 key created by the lambda_upload.sh tool above.

It takes a few minutes for CloudFormation to create your Lambda
function.  You can watch its progress at the AWS CloudFormation console.

The above CloudFormation template sets up everything you need: It grants
the necessary EC2 and CloudWatchLogs permissions for the Lambda function
to do its job, and it creates CloudWatch Events rules and gives them
permission to invoke your Lambda.

## Invoking ClassicMirror as a test

You can visit the AWS Lambda console at this point and test your
function.  If you would like a sample event to test against, go to
'Configure sample event' and paste in what you see at
tst/cloudwatch_event_authorizesecuritygroupingress.json.
This is representative of an event you might receive from CloudWatch
Events when a Security Group rule gets added.  Since you have not yet
tagged any EC2-Classic Security Groups to be managed by ClassicMirror,
you will see that the Lambda runs but does not make any changes to your
resources.

At this point, any EC2 API call that matches the pattern in the
CloudWatch Events rule defined in the template will trigger your Lambda
function.  It does not make any changes to your resources until you tag
them for ClassicMirror.  Keep going to see how to do that.

## Running ClassicMirror on EC2-Classic instances

To run this demo, we recommend creating a new VPC in your account.  Note
its VPC id (e.g. vpc-11112222).

To see ClassicMirror make some changes, tag an EC2-Classic Security Group
in your account with classicmirror:linkToVPC = vpc-11112222.

Within a minute or two, ClassicMirror will create a Security Group in your
VPC with the same name.  Observe that it also ClassicLinks any EC2-Classic
instances that are members of the Security Group that you tagged to
that mirrored Security Group in your VPC.

Some other things to try:
* Authorize and revoke CIDR ranges on your tagged Security Group.  Observe
that ClassicMirror propagates those changes to the mirrored Security Group
in your VPC.
* Create new EC2-Classic Security Groups and tag them with the
classicmirror:LinkToVPC tag.  Observe that ClassicMirror creates matching
Security Groups for them in your VPC as well.
* Authorize and revoke other classicmirror-tagged EC2-Classic Security
Groups to one another.  Observe that ClassicMirror propagates those
references, translating them to the appropriate mirror VPC Security
Groups.

# Customizing ClassicMirror

## Running unit tests

This package uses [nodeunit](https://github.com/caolan/nodeunit) for unit
tests.  When you change the Lambda function code, run the unit tests to
ensure that everything still works as expected:

```bash
nodeunit ./tst
```

Test functions are exported in tst/test_*.  The tst directory also
contains some example CloudWatch events.

## Deploying your changes

When you are ready to deploy your changes to your Lambda function, you
will run the tools/lambda_upload.sh script again, noting the S3 key it
uploads to.

Then you will tell Lambda to update its function code.  You can use the
CloudFormation template included in this package to update the Lambda and
point it to your zip file in S3.

```bash
aws cloudformation update-stack --stack-name ClassicMirrorLambda \
   --region $AWS_REGION \
   --capabilities CAPABILITY_IAM \
   --template-body file://$(realpath ./cloudformation/classicmirror_lambda_template.json) \
   --parameters ParameterKey=LambdaFunctionS3BucketBase,ParameterValue=$S3_BUCKET_BASE_NAME \
     ParameterKey=LambdaFunctionS3Key,ParameterValue=$S3_KEY
```

It takes a few seconds for CloudFormation to update your Lambda function.

You can go back to the AWS Lambda console to test it and verify that your
changes made it there.

