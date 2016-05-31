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

exports.LINK_TO_VPC_TAG_KEY = 'classicmirror:linkToVPC';
exports.COPYTAG_CLASSIC_SG_KEY = 'classicmirror:mirroredToVpcSecurityGroupId';
exports.COPYTAG_VPC_SG_KEY = 'classicmirror:mirroredFromClassicSecurityGroupId';
exports.UPDATE_TIMESTAMP_TAG_KEY = 'classicmirror:lastUpdatedTime';
exports.LAST_ERROR_TAG_KEY = 'classicmirror:lastUpdateError';

exports.getResourceTagValue = function(o, tagKey) {
    var value = undefined;
    for (var i = 0; !value && (i < o.Tags.length); i++) {
        if (o.Tags[i].Key == tagKey) {
            value = o.Tags[i].Value;
        }
    }
    return value;
};

// Shorten the error string if necessary to fit within the 255-character
// limit for tag values.
exports.lastErrorTagValue = function(err) {
    var MAX_ERROR_DETAIL = 200;
    var errorString = err;
    if (err.length > MAX_ERROR_DETAIL) {
        errorString = err.substring(0, MAX_ERROR_DETAIL) + '...';
    }
    var now = new Date();
    return '\'' + errorString + '\' at ' + now.toISOString();
}
