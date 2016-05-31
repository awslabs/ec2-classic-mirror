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

var createSecurityGroups = require('../lib/create_security_groups.js');
var cleanupSecurityGroups = require('../lib/cleanup_orphaned_security_groups.js');
var Tags = require('../lib/tags.js');
var Ec2Mock = require('./ec2mock.js');
var SgMock = require('./sgmock.js');

exports.setUp = function(callback) {
    this.ec2mock = new Ec2Mock();
    callback();
};


exports.createCleanupSecurityGroups = {
    setUp: function(callback) {
        this.vpcId = 'vpc-11111111';
        this.classicSg1 = new SgMock('sg-11111111').withLinkToVpc(this.vpcId)
            .withCopiedToVpc('sg-abababab'); // wrong
        this.classicSg2 = new SgMock('sg-22222222').withLinkToVpc(this.vpcId);
        this.classicSg3 = new SgMock('sg-33333333').withLinkToVpc(this.vpcId);
        this.vpcSg4 = new SgMock('sg-44444444').withVpcId(this.vpcId).withCopiedFromClassic('sg-11111111');
        this.vpcSg5 = new SgMock('sg-55555555').withVpcId(this.vpcId).withCopiedFromClassic('sg-ffffffff');
        this.vpcSg6 = new SgMock('sg-66666666').withVpcId(this.vpcId).withCopiedFromClassic('sg-fefefefe');
        this.ec2mock.securityGroups = [this.classicSg1, this.classicSg2, this.classicSg3, this.vpcSg4, this.vpcSg5, this.vpcSg6];

        this.securityGroupPairs = [
            { classicSecurityGroup: this.classicSg1, vpcSecurityGroup: this.vpcSg4 },
            { classicSecurityGroup: this.classicSg2 },
            { classicSecurityGroup: this.classicSg3 },
            { vpcSecurityGroup: this.vpcSg5 },
            { vpcSecurityGroup: this.vpcSg6 },
        ];

        // Keep track of deleted SGs
        this.deletedGroupIds = [];
        var _deleteSecurityGroup = this.ec2mock.deleteSecurityGroup.bind(this.ec2mock);
        var that = this;
        this.ec2mock.deleteSecurityGroup = function(params, callback) {
            _deleteSecurityGroup(params, function(err, data) {
                if (data) that.deletedGroupIds.push(params.GroupId);
                callback(err, data);
            });
        }

        callback();
    },

    testCreateCleanupSecurityGroups: function(test) {
        createSecurityGroups.init(this.ec2mock);
        cleanupSecurityGroups.init(this.ec2mock);
        var that = this;
        createSecurityGroups.createVpcMirroredSecurityGroups(this.securityGroupPairs, function(err, data) {
            test.ok(!err);
            test.equals(that.securityGroupPairs.length, 5);

            test.equals(that.securityGroupPairs[0].classicSecurityGroup.GroupId, that.classicSg1.GroupId);
            test.equals(Tags.getResourceTagValue(that.securityGroupPairs[0].classicSecurityGroup, Tags.COPYTAG_CLASSIC_SG_KEY), that.vpcSg4.GroupId);
            test.equals(that.securityGroupPairs[0].vpcSecurityGroup.GroupId, that.vpcSg4.GroupId);

            test.equals(that.securityGroupPairs[1].classicSecurityGroup.GroupId, that.classicSg2.GroupId);
            test.ok(Tags.getResourceTagValue(that.securityGroupPairs[1].classicSecurityGroup, Tags.COPYTAG_CLASSIC_SG_KEY));
            test.ok(that.securityGroupPairs[1].vpcSecurityGroup);
            test.equals(that.securityGroupPairs[1].vpcSecurityGroup.VpcId, that.vpcId);
            test.equals(Tags.getResourceTagValue(that.securityGroupPairs[1].vpcSecurityGroup, Tags.COPYTAG_VPC_SG_KEY), that.classicSg2.GroupId);

            test.equals(that.securityGroupPairs[2].classicSecurityGroup.GroupId, that.classicSg3.GroupId);
            test.ok(Tags.getResourceTagValue(that.securityGroupPairs[2].classicSecurityGroup, Tags.COPYTAG_CLASSIC_SG_KEY));
            test.ok(that.securityGroupPairs[2].vpcSecurityGroup);
            test.equals(that.securityGroupPairs[2].vpcSecurityGroup.VpcId, that.vpcId);
            test.equals(Tags.getResourceTagValue(that.securityGroupPairs[2].vpcSecurityGroup, Tags.COPYTAG_VPC_SG_KEY), that.classicSg3.GroupId);

            test.ok(!that.securityGroupPairs[3].classicSecurityGroup);
            test.equals(that.securityGroupPairs[3].vpcSecurityGroup.GroupId, that.vpcSg5.GroupId);

            cleanupSecurityGroups.cleanupOrphanedVpcMirroredSecurityGroups(that.securityGroupPairs, function(err, data) {
                test.ok(!err);
                test.equals(that.securityGroupPairs.length, 3);
                for (var i = 0; i < that.securityGroupPairs.length; i++) {
                    test.ok(that.securityGroupPairs[i].classicSecurityGroup);
                }
                test.deepEqual(that.deletedGroupIds.sort(), ['sg-55555555', 'sg-66666666']);
                test.done();
            });
       });
    },

    testCreateSecurityGroupFail: function(test) {
        // Force a failure on the first attempt
        var firstTime = true;
        var _createSecurityGroup = this.ec2mock.createSecurityGroup.bind(this.ec2mock);
        this.ec2mock.createSecurityGroup = function(params, callback) {
            if (firstTime) {
                firstTime = false;
                callback('FAILING createSecurityGroup ' + JSON.stringify(params));
            } else {
                _createSecurityGroup(params, callback);
            }
        };
        createSecurityGroups.init(this.ec2mock);

        var that = this;
        createSecurityGroups.createVpcMirroredSecurityGroups(this.securityGroupPairs, function(err, data) {

            // One of the attempts to createSecurityGroups failed, but
            // this should succeed.
            test.ok(!err);
            test.equals(that.securityGroupPairs.length, 5);

            test.ok(!that.securityGroupPairs[1].vpcSecurityGroup);
            test.ok(that.securityGroupPairs[1].error);
            test.ok(that.securityGroupPairs[2].vpcSecurityGroup);

            test.done();
        });
    },

    testCreateTagsFail: function(test) {

        // Force a failure on all createTags attempts
        this.ec2mock.createTags = function(params, callback) {
            callback('FAILING createTags ' + JSON.stringify(params));
        };
        createSecurityGroups.init(this.ec2mock);

        var that = this;
        createSecurityGroups.createVpcMirroredSecurityGroups(this.securityGroupPairs, function(err, data) {
            test.ok(!err);
            test.equals(that.securityGroupPairs.length, 5);
            test.ok(!that.securityGroupPairs[1].vpcSecurityGroup);
            test.ok(!that.securityGroupPairs[2].vpcSecurityGroup);
            test.equals(that.deletedGroupIds.length, 2);
            test.equals(Tags.getResourceTagValue(that.securityGroupPairs[1].classicSecurityGroup, Tags.COPYTAG_CLASSIC_SG_KEY), undefined);
            test.equals(Tags.getResourceTagValue(that.securityGroupPairs[2].classicSecurityGroup, Tags.COPYTAG_CLASSIC_SG_KEY), undefined);
            test.done();
        });
    },

    cleanupOrphanedFail: function(test) {

        // Force a failure while attempting to delete sg-55555555
        var _deleteSecurityGroup = this.ec2mock.deleteSecurityGroup.bind(this.ec2mock);
        var that = this;
        this.ec2mock.deleteSecurityGroup = function(params, callback) {
            if (params.GroupId == 'sg-55555555') {
                callback('FAIL deletion of sg-55555555');
            } else {
                _deleteSecurityGroup(params, callback);
            }
        };

        cleanupSecurityGroups.init(this.ec2mock);
        cleanupSecurityGroups.cleanupOrphanedVpcMirroredSecurityGroups(this.securityGroupPairs, function(err, data) {
            test.ok(!err);

            // Expect: Both entries are removed from securityGroupPairs,
            //         even the failing one.
            // But only one of them got successfully deleted
            test.equals(that.securityGroupPairs.length, 3);
            test.deepEqual(that.deletedGroupIds, ['sg-66666666']);
        });
        test.done();
    }
};

