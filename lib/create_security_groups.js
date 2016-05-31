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

// For any ClassicMirror-managed Security Groups that do not yet have
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
            // classicmirror:mirroredToVpcSecurityGroupId, in case that
            // tag is not already there.
            return _tagClassicSecurityGroupPromise(pair.classicSecurityGroup.GroupId, pair.vpcSecurityGroup.GroupId);
        } else {
            // Create a new VPC Security Group
            numToCreate++;
            return _createSecurityGroupPromise(pair);
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

function _createSecurityGroupPromise(pair) {
    var vpcId = Tags.getResourceTagValue(pair.classicSecurityGroup, Tags.LINK_TO_VPC_TAG_KEY);
    console.log('CreateSecurityGroups: Creating mirror Security Group in ' + vpcId + ' for Classic Security Group ' + pair.classicSecurityGroup.GroupId);

    // Create the new Security Group in the VPC
    var createParams = {
        VpcId: vpcId,
        GroupName: pair.classicSecurityGroup.GroupName,
        Description: pair.classicSecurityGroup.Description
    };
    var vpcSecurityGroupId = undefined;
    return ec2CreateSecurityGroup(createParams)
        .then(function(data) {
            vpcSecurityGroupId = data.GroupId;
            console.log('CreateSecurityGroups: Created ' + vpcSecurityGroupId + ' in ' + createParams.VpcId + ' to mirror ' + pair.classicSecurityGroup.GroupId);
            pair.createdVpcSecurityGroupId = vpcSecurityGroupId;

            // Tag the VPC Security Group with
            // classicmirror:mirroredFromClassicSecurityGroupId =
            // classicSgId
            var tagVpcSecurityGroupParams = {
                Resources: [ vpcSecurityGroupId ],
                Tags: [ { Key: Tags.COPYTAG_VPC_SG_KEY, Value: pair.classicSecurityGroup.GroupId } ]
            };
            return ec2CreateTags(tagVpcSecurityGroupParams);
        }).then(function() {
            // Tag the Classic Security Group with
            // classicmirror:mirroredToVpcSecurityGroupId = vpcSgId
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
    if (pair.createdVpcSecurityGroupId) {
        console.log('CreateSecurityGroups: Clean up failed creation of ' + pair.createdVpcSecurityGroupId);

        // Delete the VPC Security Group
        return ec2DeleteSecurityGroup({GroupId: pair.createdVpcSecurityGroupId}).then(function() {
            // Delete the tag on the Classic Security Group that points
            // to it
            return ec2DeleteTags({Resources: [pair.classicSecurityGroup.GroupId], Tags: [{Key: Tags.COPYTAG_CLASSIC_SG_KEY, Value: pair.createdVpcSecurityGroupId}]});
        }).then(function() {
            return Promise.resolve(pair);
        }).catch(function(err) {
            console.error('CreateSecurityGroups: Failed cleanup of ' + pair.createdVpcSecurityGroupId + ': ' + JSON.stringify(err));
            return Promise.resolve(pair);
        });
    } else {
        return Promise.resolve(pair);
    }
 }


