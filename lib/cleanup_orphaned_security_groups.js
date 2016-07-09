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
var Tags = require('./tags');

var ec2DeleteSecurityGroup;

// For any VPC Security Groups that look like they were managed by
// ClassicLink Mirror but the corresponding Classic Security Group has
// since been deleted or untagged, delete those VPC Security Groups.

exports.init = function(ec2) {
    ec2DeleteSecurityGroup = Promise.denodeify(ec2.deleteSecurityGroup).bind(ec2);
    ec2DeleteTags = Promise.denodeify(ec2.deleteTags).bind(ec2);
};

exports.cleanupOrphanedVpcMirroredSecurityGroups = function(securityGroupPairs, callback) {

    var orphanedSecurityGroups = [];
    var i = 0;
    while (i < securityGroupPairs.length) {
        if (securityGroupPairs[i].classicSecurityGroup) {
            i++;
        } else {
            orphanedSecurityGroups.push(securityGroupPairs[i].vpcSecurityGroup);

            // Regardless of whether we actually succeed in deleting
            // these, remove them from our list of pairs
            securityGroupPairs.splice(i, 1);
        }
    }

    var cleanupSecurityGroupPromises = orphanedSecurityGroups.map(function(group) {
        if (group.GroupName == 'default') {
            // Because we cannnot delete a VPC's default Security Group,
            // instead clean up any tags we may have written on it.
            return _cleanupTagsPromise(group.GroupId);
        } else {
            return _deleteSecurityGroupPromise(group.GroupId);
        }
    });

    return Promise.all(cleanupSecurityGroupPromises)
        .then(function() {
            return Promise.resolve(securityGroupPairs);
        }).nodeify(callback);
};

function _cleanupTagsPromise(groupId) {
    var tagKeys = [
        Tags.COPYTAG_VPC_SG_KEY,
        Tags.UPDATE_TIMESTAMP_TAG_KEY,
        Tags.LAST_ERROR_TAG_KEY
    ];
    var tagParams = {
        Resources: [ groupId ],
        Tags: tagKeys.map(function(k) { return { Key: k }; })
    };
    return ec2DeleteTags(tagParams).then(function() {
        console.log('CleanupOrphanedSecurityGroups: Cleaned up tags ' + JSON.stringify(tagKeys) + ' from VPC default Security Group ' + groupId);
    }).catch(function(err) {
        console.error('CleanupOrphanedSecurityGroups: Error deleting tags ' + JSON.stringify(tagKeys) + ' from VPC default Security Group ' + groupId + ': ' + err);
    });
}

function _deleteSecurityGroupPromise(groupId) {
    return ec2DeleteSecurityGroup({GroupId: groupId}).then(function() {
        console.log('CleanupOrphanedSecurityGroups: Deleted orphaned VPC Security Group ' + groupId);
        return Promise.resolve(groupId);
    }).catch(function(err) {
        console.error('CleanupOrphanedSecurityGroups: Error deleting orphaned VPC Security Group ' + groupId + ': ' + err);
        return Promise.resolve(groupId);
    });
}



