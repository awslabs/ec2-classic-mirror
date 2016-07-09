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

var Promise = require('promise');
var Tags = require('./tags.js')

// Determines whether an incoming CloudWatch event might be relevant to
// ClassicLink Mirror.
//
// The following types of events are never relevant:
// * API calls that failed
// * API calls made by the same role that this Lambda runs in
//
// The following types of events might be relevant:
// * Create/DeleteTags on the classiclinkmirror:linkToVPC tag
// * RunInstances
// * Authorize/RevokeSecurityGrouopIngress

var DETAIL_TYPE_EC2_API = 'AWS API Call via CloudTrail';
var DETAIL_TYPE_EC2_INSTANCE_STATE_CHANGE = 'EC2 Instance State-change Notification';
var lambdaGetFunctionConfiguration;

exports.init = function(lambda) {
    lambdaGetFunctionConfiguration = Promise.denodeify(lambda.getFunctionConfiguration).bind(lambda);
};

exports.filterCloudWatchEvent = function(cloudWatchEvent, functionArn, callback) {

    var promise = Promise.resolve({isRelevant: false});

    if (cloudWatchEvent && cloudWatchEvent.detail && !cloudWatchEvent.detail.errorCode) {
        var detail = cloudWatchEvent.detail;
        var detailType = cloudWatchEvent['detail-type'];
        if (detailType == DETAIL_TYPE_EC2_API) {
            promise = _filterEC2APICallEventPromise(detail, functionArn);
        } else if (detailType == DETAIL_TYPE_EC2_INSTANCE_STATE_CHANGE) {
            promise = _filterInstanceStateChangeEventPromise(detail);
        }
    }

    return promise.nodeify(callback);
}

function _filterEC2APICallEventPromise(detail, functionArn) {
    return lambdaGetFunctionConfiguration({FunctionName: functionArn}).then(function(data) {

        var result = false;

        // Check the role in the event versus the role under which
        // we're running
        var currentRole = data.Role;
        var eventRole = null;
        if (detail && detail.userIdentity && detail.userIdentity.sessionContext && detail.userIdentity.sessionContext.sessionIssuer && (detail.userIdentity.sessionContext.sessionIssuer.type == 'Role')) {
            eventRole = detail.userIdentity.sessionContext.sessionIssuer.arn;
        }
        if (eventRole == currentRole) {
            console.log('CloudWatchEventFilter: initiated by own role');
            result = false;
        } else if ((detail.eventName == 'CreateTags') ||
                   (detail.eventName == 'DeleteTags')) {
            var requestParams = detail.requestParameters;
            if (requestParams &&
                requestParams.tagSet &&
                requestParams.tagSet.items) {
                for (var tag of requestParams.tagSet.items) {
                    if (tag.key == Tags.LINK_TO_VPC_TAG_KEY) {
                        result = true;
                    }
                }
            }
        } else if ((detail.eventName == 'AuthorizeSecurityGroupIngress') ||
                   (detail.eventName == 'RevokeSecurityGroupIngress') ||
                   (detail.eventName == 'DeleteSecurityGroup') ||
                   (detail.eventName == 'RunInstances')) {
            result = true;
        }
        return Promise.resolve({isRelevant: result});
    });
}

function _filterInstanceStateChangeEventPromise(detail) {
   return Promise.resolve({isRelevant: (detail.state == 'running')});
}

