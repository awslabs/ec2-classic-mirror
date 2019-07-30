/*
 * Copyright 2016 Amazon.com, Inc. or its affiliates. All Rights Reserved.
 *
 * SPDX-License-Identifier: MIT-0
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

    // Iterate through the list of pairs, looking for Security Groups
    // that have no partner.  Keep a list of orphaned VPC Security Groups
    // that we need to delete.
    // For any incomplete pairs, remove them from out list of Security
    // Group pairs, since we will do nothing more with them.
    var orphanedSecurityGroups = [];
    var i = 0;
    while (i < securityGroupPairs.length) {
        var classicSecurityGroup = securityGroupPairs[i].classicSecurityGroup;
        var vpcSecurityGroup = securityGroupPairs[i].vpcSecurityGroup;
        if (classicSecurityGroup && vpcSecurityGroup) {
            // This is a pair we will sync; leave it here and move on.
            i++;
        } else {
            if (vpcSecurityGroup) {
                console.log('CleanupOrphanedSecurityGroups: Security Group ' + vpcSecurityGroup.GroupId + ' in ' + vpcSecurityGroup.VpcId + ' has no Classic Security Group mirroring to it; will clean it up');
                orphanedSecurityGroups.push(vpcSecurityGroup);
            } else if (classicSecurityGroup) {
                console.log('CleanupOrphanedSecurityGroups: Security Group ' + classicSecurityGroup.GroupId + ' (EC2-Classic), error \'' + securityGroupPairs[i].error + '\'');
            } else {
                console.error('CleanupOrphanedSecurityGroups: Both groups null; likely code bug');
            }

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



