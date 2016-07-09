/*
 * Copyright 2016 Amazon.com, Inc. or its affiliates. All Rights Reserved.
 *
 * Licensed under the Amazon Software License (the "License"). You
 * may not use this file except in compliance with the License. A copy
 * of the License is located at
 *
 * http://aws.amazon.com/asl/
 *
 * or in the "license" file accompanying this file. This file is
 * distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF
 * ANY KIND, express or implied. See the License for the specific
 * language governing permissions and limitations under the License.
 */

module.exports = function LambdaMock() {
    this.getFunctionConfiguration = function(params, callback) {
        callback(null, {
            FunctionName: 'MyLambdaFunctionName',
            FunctionArn: params.FunctionName,
            Role: 'arn:aws:iam::111122223333:role/ClassicLinkMirror/LambdaExecRole/ClassicLinkMirrorLambda-LambdaExecRole-1TAPM87GGXL8V'
        });
    };
};
