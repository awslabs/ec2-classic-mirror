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

// Creates a set of Classic/VPC Security Group pairs.
// A given pair might have:
// * Just a Classic Security Group, meaning that the corresponding VPC
//   Security Group needs to be created.
// * Both a Classic and a VPC Security Group, meaning that we already have
//   a VPC Security Group to which we are mirroring the Classic Security
//   Group.
// * Just a VPC Security Group, meaning that we found a VPC Security
//   Group that had been mirrored from a Classic Security Group but should
//   no longer be, because the Classic Security Group was deleted or
//   untagged for ClassicMirroring.


exports.init = function(ec2) {
    this.ec2DescribeSecurityGroups = Promise.denodeify(ec2.describeSecurityGroups).bind(ec2);
};

exports.describeSecurityGroupPairs = function(callback) {

    // Describe Classic Security Groups that the user has tagged
    // classicmirror:linkToVPC
    var classicDescribeParams = {
        Filters: [
            { Name: 'tag-key', Values: [ Tags.LINK_TO_VPC_TAG_KEY ] }
        ]
    };

    // Describe VPC Security Groups that we appear to have tagged with
    // classicmirror:mirroredFromClassicSecurityGroupId, meaning that we
    // have been managing their rules as part of a pair
    var vpcDescribeParams = {
        Filters: [
            { Name: 'tag-key', Values: [ Tags.COPYTAG_VPC_SG_KEY ] }
         ]
    };

    var that = this;
    var securityGroupPairs = [];
    return this.ec2DescribeSecurityGroups(classicDescribeParams)
        .then(function(data) {
            // Classic Security Groups with the LinkToVPC tag: These are
            // the Classic Security Groups we manage.  Put them in the
            // securityGroupPairs array
            securityGroupPairs = data.SecurityGroups.sort(function(sg1, sg2) {
                return sg1.GroupId.localeCompare(sg2.GroupId);
            }).map(function(sg) {
                return { classicSecurityGroup: sg };
            });
            return that.ec2DescribeSecurityGroups(vpcDescribeParams);
        }).then(function(data) {
            // VPC Security Groups that we were previously managing:
            // Find the corresponsing Classic Security Group (according
            // to the classicMirror:ClassicSecurityGroupId tag we put on
            // it); if there is no match, then its Classic counterpart
            // might have been deleted or untagged, so we will want this
            // VPC Security Group in its own pair.
            for (var i = 0; i < data.SecurityGroups.length; i++) {
                var vpcSecurityGroup = data.SecurityGroups[i];
                var vpcId = vpcSecurityGroup.VpcId;
                var copiedFromClassicGroupId = Tags.getResourceTagValue(vpcSecurityGroup, Tags.COPYTAG_VPC_SG_KEY);
                var foundPair = undefined;
                for (var j = 0; !foundPair && (j < securityGroupPairs.length); j++) {
                    if (securityGroupPairs[j].classicSecurityGroup && securityGroupPairs[j].classicSecurityGroup.GroupId == copiedFromClassicGroupId) {
                        foundPair = securityGroupPairs[j];
                    }
                }

                if (foundPair) {
                    var classicSecurityGroup = foundPair.classicSecurityGroup;
                    var linkToVpcId = Tags.getResourceTagValue(classicSecurityGroup, Tags.LINK_TO_VPC_TAG_KEY);
                    if (linkToVpcId && linkToVpcId != vpcId) {
                        // Skip this VPC Security Group; it's in a
                        // different VPC from the one its Classic
                        // counterpart links to
                        console.warn('DescribeSecurityGroups Warning: ' + vpcSecurityGroup.GroupId + ': Classic Security Group ' + copiedFromClassicGroupId + ' links to ' + linkToVpcId + ' but VPC Security Group ' + vpcSecurityGroup.GroupId + ' is in ' + vpcId);
                        foundPair = undefined;
                    } else if (foundPair.vpcSecurityGroup) {
                        // Skip this VPC SecurityGroup; the Classic
                        // SecurityGroup it points to is copying to
                        // some other VPC Security Group
                        console.warn('DescribeSecurityGroups Warning ' + vpcSecurityGroup.GroupId + ': Classic Security Group ' + classicSecurityGroup.GroupId + ' already is being copied to ' + foundPair.vpcSecurityGroup.GroupId);
                        foundPair = undefined;
                    }
                }

                if (foundPair) {
                    foundPair.vpcSecurityGroup = vpcSecurityGroup;
                } else {
                    securityGroupPairs.push({vpcSecurityGroup: vpcSecurityGroup});
                }
            }

            // Write them to the log
            securityGroupPairs.forEach(function(pair) {
                console.log('DescribeSecurityGroups: Pair ' + i + ' ' + (pair.classicSecurityGroup ? pair.classicSecurityGroup.GroupId : 'NONE') + '-->' + (pair.vpcSecurityGroup ? pair.vpcSecurityGroup.GroupId : 'NONE'));
            });

            return Promise.resolve(securityGroupPairs);
        }).nodeify(callback);

    // Failures of DescribeSecurityGroups are not caught here.  We
    // propagate them as failures so that the Lambda will fail and be
    // retried.
};
