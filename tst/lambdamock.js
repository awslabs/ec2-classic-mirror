/*
 * Copyright 2016 Amazon.com, Inc. or its affiliates. All Rights Reserved.
 *
 * SPDX-License-Identifier: MIT-0
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
