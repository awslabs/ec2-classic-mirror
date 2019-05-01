/*
 * Copyright 2016 Amazon.com, Inc. or its affiliates. All Rights Reserved.
 *
 * SPDX-License-Identifier: MIT-0
 */

exports.LINK_TO_VPC_TAG_KEY = 'classiclinkmirror:linkToVPC';
exports.COPYTAG_CLASSIC_SG_KEY = 'classiclinkmirror:mirroredToVpcSecurityGroupId';
exports.COPYTAG_VPC_SG_KEY = 'classiclinkmirror:mirroredFromClassicSecurityGroupId';
exports.UPDATE_TIMESTAMP_TAG_KEY = 'classiclinkmirror:lastUpdatedTime';
exports.LAST_ERROR_TAG_KEY = 'classiclinkmirror:lastUpdateError';

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
