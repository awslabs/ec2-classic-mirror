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

var ec2CreateSecurityGroup;
var ec2CreateTags;
var ec2DeleteSecurityGroup;
var ec2DeleteTags;
var ec2DescribeSecurityGroups;

// For any ClassicLink Mirror-managed Security Groups that do not yet have
// a mirror in the VPC's Security Groups, create one.

exports.init = function(ec2) {
    ec2CreateSecurityGroup = Promise.denodeify(ec2.createSecurityGroup).bind(ec2);
    ec2CreateTags = Promise.denodeify(ec2.createTags).bind(ec2);
    ec2DeleteSecurityGroup = Promise.denodeify(ec2.deleteSecurityGroup).bind(ec2);
    ec2DeleteTags = Promise.denodeify(ec2.deleteTags).bind(ec2);
    ec2DescribeSecurityGroups = Promise.denodeify(ec2.describeSecurityGroups).bind(ec2);
};

exports.createVpcMirroredSecurityGroups = function(securityGroupPairs, callback) {
    var numToCreate = 0;
    var promises = securityGroupPairs.filter(function(pair) {
        return pair.classicSecurityGroup;
    }).map(function(pair) {
        if (pair.vpcSecurityGroup) {
            // There is already a mirrored Security Group in the VPC.
            // Tag the Classic Security Group with
            // classiclinkmirror:mirroredToVpcSecurityGroupId, in case
            // that tag is not already there.
            return _tagClassicSecurityGroupPromise(pair.classicSecurityGroup.GroupId, pair.vpcSecurityGroup.GroupId);
        } else {
            // Create a new VPC Security Group
            numToCreate++;
            return _createAndTagSecurityGroupPromise(pair);
        }
    });
    console.log('CreateSecurityGroups: Creating ' + numToCreate + ' new Security Groups');
    return Promise.all(promises)
        .then(function(values) {
            return Promise.resolve(securityGroupPairs);
        }).nodeify(callback);
};


function _tagClassicSecurityGroupPromise(classicSecurityGroupId, vpcSecurityGroupId) {
    console.log('CreateSecurityGroups: Tagging ' + classicSecurityGroupId + ': ' + Tags.COPYTAG_CLASSIC_SG_KEY + '=' + vpcSecurityGroupId);

    var tagClassicSecurityGroupParams = {
        Resources: [ classicSecurityGroupId ],
        Tags: [ { Key: Tags.COPYTAG_CLASSIC_SG_KEY, Value: vpcSecurityGroupId } ]
    };
    return ec2CreateTags(tagClassicSecurityGroupParams).catch(function(err) {
        console.error('CreateSecurityGroups: Error tagging ' + classicSecurityGroupId + ' with ' + vpcSecurityGroupId + ': ' + err);
        return Promise.resolve(null);
    });
}

function _createSecurityGroupPromise(vpcId, groupName, description) {
    if (groupName == 'default') {
        // This is a special case.  Security Groups named 'default' exist
        // and cannot be created/deleted.  Instead, find the existing
        // default Security Group
        var findDefaultParams = {
            Filters: [
                { Name: 'vpc-id', Values: [ vpcId ] },
                { Name: 'group-name', Values: [ 'default' ] }
            ]
        };
        return ec2DescribeSecurityGroups(findDefaultParams)
            .then(function(data) {
                console.log('CreateSecurityGroups: Mirroring to default Security Group ' + data.SecurityGroups[0].GroupId + ' in ' + vpcId);
                return Promise.resolve(data.SecurityGroups[0]);
            });
    } else {
        var createParams = {
            VpcId: vpcId,
            GroupName: groupName,
            Description: description
        };
        return ec2CreateSecurityGroup(createParams).then(function(data) {
            console.log('CreateSecurityGroups: Created ' + data.GroupId + ' in ' + vpcId + ' to mirror group \'' + groupName + '\'');
            return Promise.resolve(data);
        });
    }
}

function _createAndTagSecurityGroupPromise(pair) {
    var vpcId = Tags.getResourceTagValue(pair.classicSecurityGroup, Tags.LINK_TO_VPC_TAG_KEY);
    console.log('CreateSecurityGroups: Creating mirror Security Group in ' + vpcId + ' for Classic Security Group ' + pair.classicSecurityGroup.GroupId);

    var vpcSecurityGroupId = undefined;
    return _createSecurityGroupPromise(vpcId, pair.classicSecurityGroup.GroupName, pair.classicSecurityGroup.Description)
        .then(function(data) {
            vpcSecurityGroupId = data.GroupId;
            pair.createdVpcSecurityGroupId = vpcSecurityGroupId;

            // Tag the VPC Security Group with
            // classiclinkmirror:mirroredFromClassicSecurityGroupId =
            // classicSgId
            var tagVpcSecurityGroupParams = {
                Resources: [ vpcSecurityGroupId ],
                Tags: [ { Key: Tags.COPYTAG_VPC_SG_KEY, Value: pair.classicSecurityGroup.GroupId } ]
            };
            return ec2CreateTags(tagVpcSecurityGroupParams);
        }).then(function() {
            // Tag the Classic Security Group with
            // classiclinkmirror:mirroredToVpcSecurityGroupId = vpcSgId
            return _tagClassicSecurityGroupPromise(pair.classicSecurityGroup.GroupId, vpcSecurityGroupId);
        }).then(function() {
            // Describe the new VPC SecurityGroup so that we can put its
            // description in the pair structure
            var describeParams = { GroupIds: [ vpcSecurityGroupId ] };
            return ec2DescribeSecurityGroups(describeParams);
        }).then(function(data) {
            // Getting here means that creating the VPC Security Group
            // and tagging both Security Groups was successful.
            pair.vpcSecurityGroup = data.SecurityGroups[0];
            delete pair.createdVpcSecurityGroupId;
            return Promise.resolve(pair);
        }).catch(function(err) {
            // Getting here means that something failed in the above steps
            // and we will need to clean up the VPC Security Group we
            // just created.
            // We note the error so that the Lambda can proceed but will
            // declare itself to have failed.
            pair.error = err;
            console.error('FAIL creating mirror Security Group for ' + pair.classicSecurityGroup.GroupId + ': ' + err);
            return _cleanupFailedGroupPromise(pair);
        });
 }

function _cleanupFailedGroupPromise(pair) {

    // Tag the EC2-Classic Security Group with the error
    var tagParams = {
        Resources: [ pair.classicSecurityGroup.GroupId ],
        Tags: [
            { Key: Tags.UPDATE_TIMESTAMP_TAG_KEY, Value: new Date().toISOString() },
            { Key: Tags.LAST_ERROR_TAG_KEY, Value: Tags.lastErrorTagValue(pair.error) }
        ]
    };
    var createFailureTagsPromise = ec2CreateTags(tagParams)
        .catch(function(err) {
            console.error('CreateSecurityGroups: Failed to tag Classic Security Group ' + pair.classicSecurityGroup.GroupId + ' with error; continuing');
        });

    // Delete the VPC Security Group.  If this was a default
    // Security Group, we won't be able to delete it, so don't try.
    var deleteSecurityGroupPromise = Promise.resolve(null);
    if (pair.createdVpcSecurityGroupId) {
        if (pair.classicSecurityGroup.GroupName == 'default') {
            console.log('CreateSecurityGroups: Clean up tags for default Security Group ' + pair.createdVpcSecurityGroupId + '; not deleting because default');
        } else {
            console.log('CreateSecurityGroups: Clean up failed creation of ' + pair.createdVpcSecurityGroupId);
            deleteSecurityGroupPromise = ec2DeleteSecurityGroup({GroupId: pair.createdVpcSecurityGroupId}).catch(function(err) {
                console.error('CreateSecurityGroups: Failed cleanup of ' + pair.createdVpcSecurityGroupId + ': ' + err);
            });
        }
    }

    return createFailureTagsPromise
        .then(deleteSecurityGroupPromise)
        .then(Promise.resolve(pair));
}


