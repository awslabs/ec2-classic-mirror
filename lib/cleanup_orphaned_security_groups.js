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

var ec2DeleteSecurityGroup;

// For any VPC Security Groups that look like they were managed by
// ClassicLink Mirror but the corresponding Classic Security Group has
// since been deleted or untagged, delete those VPC Security Groups.

exports.init = function(ec2) {
    ec2DeleteSecurityGroup = Promise.denodeify(ec2.deleteSecurityGroup).bind(ec2);
};

exports.cleanupOrphanedVpcMirroredSecurityGroups = function(securityGroupPairs, callback) {

    // Regardless of whether we actually succeed in deleting these,
    // remove them from our list of pairs
    var orphanedSecurityGroupIds = [];
    var i = 0;
    while (i < securityGroupPairs.length) {
        if (securityGroupPairs[i].classicSecurityGroup) {
            i++;
        } else {
            orphanedSecurityGroupIds.push(securityGroupPairs[i].vpcSecurityGroup.GroupId);
            securityGroupPairs.splice(i, 1);
        }
    }

    var deleteSecurityGroupPromises = orphanedSecurityGroupIds.map(function(groupId) {
        return ec2DeleteSecurityGroup({GroupId: groupId}).then(function() {
            console.log('CleanupOrphanedSecurityGroups: Deleted orphaned VPC Security Group ' + groupId);
            return Promise.resolve(groupId);
        }).catch(function(err) {
            console.error('CleanupOrphanedSecurityGroups: Error deleting orphaned VPC Security Group ' + groupId + ': ' + err);
            return Promise.resolve(groupId);
        });
    });

    return Promise.all(deleteSecurityGroupPromises)
        .then(function() {
            return Promise.resolve(securityGroupPairs);
        }).nodeify(callback);
};
