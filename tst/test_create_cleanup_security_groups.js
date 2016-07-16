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
        this.otherVpcId = 'vpc-22222222';
        this.classicSg1 = new SgMock('sg-11111111').withLinkToVpc(this.vpcId)
            .withCopiedToVpc('sg-abababab'); // wrong
        this.classicSg2 = new SgMock('sg-22222222').withLinkToVpc(this.vpcId);
        this.classicSg3 = new SgMock('sg-33333333').withLinkToVpc(this.vpcId);
        this.vpcSg4 = new SgMock('sg-44444444').withVpcId(this.vpcId).withCopiedFromClassic('sg-11111111');
        this.vpcSg5 = new SgMock('sg-55555555').withVpcId(this.vpcId).withCopiedFromClassic('sg-ffffffff');
        this.vpcSg6 = new SgMock('sg-66666666').withVpcId(this.vpcId).withCopiedFromClassic('sg-fefefefe');

        // Default Security Groups
        this.classicSgDefault = new SgMock('sg-77777777')
            .withGroupName('default')
            .withLinkToVpc(this.vpcId);
        this.vpcSgDefault = new SgMock('sg-88888888')
            .withVpcId(this.vpcId)
            .withGroupName('default');
        this.otherVpcSgDefault = new SgMock('sg-99999999')
            .withVpcId(this.otherVpcId)
            .withGroupName('default')
            .withCopiedFromClassic('sg-fdfdfdfd')
            .withTag(Tags.UPDATE_TIMESTAMP_TAG_KEY, 'good ol days');

        // Conflicting names
        this.classicSgNamedFoo = new SgMock('sg-0000f000')
            .withGroupName('foo')
            .withLinkToVpc(this.vpcId);
        this.vpcSgNamedFoo = new SgMock('sg-0000f001')
            .withVpcId(this.vpcId)
            .withGroupName('foo');

        this.ec2mock.securityGroups = [this.classicSg1, this.classicSg2, this.classicSg3, this.vpcSg4, this.vpcSg5, this.vpcSg6, this.classicSgDefault, this.vpcSgDefault, this.otherVpcSgDefault, this.classicSgNamedFoo, this.vpcSgNamedFoo];

        this.securityGroupPairs = [
            { classicSecurityGroup: this.classicSg1, vpcSecurityGroup: this.vpcSg4 },
            { classicSecurityGroup: this.classicSg2 },
            { classicSecurityGroup: this.classicSg3 },
            { vpcSecurityGroup: this.vpcSg5 },
            { vpcSecurityGroup: this.vpcSg6 },
            { classicSecurityGroup: this.classicSgDefault },
            { vpcSecurityGroup: this.otherVpcSgDefault },
            { classicSecurityGroup: this.classicSgNamedFoo }
        ];
        this.originalSecurityGroupPairsCount = this.securityGroupPairs.length;

        // Keep track of deleted SGs
        this.deletedGroupIds = [];
        var _deleteSecurityGroup = this.ec2mock.deleteSecurityGroup.bind(this.ec2mock);
        var that = this;
        this.ec2mock.deleteSecurityGroup = function(params, callback) {
            that.deletedGroupIds.push(params.GroupId);
            _deleteSecurityGroup(params, callback);
        }

        callback();
    },

    testCreateCleanupSecurityGroups: function(test) {
        createSecurityGroups.init(this.ec2mock);
        cleanupSecurityGroups.init(this.ec2mock);
        var that = this;
        createSecurityGroups.createVpcMirroredSecurityGroups(this.securityGroupPairs, function(err, data) {
            test.ok(!err);
            test.equals(that.securityGroupPairs.length, that.originalSecurityGroupPairsCount);

            _validatePair(test, that.securityGroupPairs[0], that.classicSg1.GroupId, that.vpcSg4.GroupId, that.vpcId);
            _validatePair(test, that.securityGroupPairs[1], that.classicSg2.GroupId, null, that.vpcId);
            _validatePair(test, that.securityGroupPairs[2], that.classicSg3.GroupId, null, that.vpcId);

            test.ok(!that.securityGroupPairs[3].classicSecurityGroup);
            test.equals(that.securityGroupPairs[3].vpcSecurityGroup.GroupId, that.vpcSg5.GroupId);

            _validatePair(test, that.securityGroupPairs[5], that.classicSgDefault.GroupId, that.vpcSgDefault.GroupId, that.vpcId);

            cleanupSecurityGroups.cleanupOrphanedVpcMirroredSecurityGroups(that.securityGroupPairs, function(err, data) {
                test.ok(!err);

                // One of the orphans is a default Security Group; we
                // should not be trying to delete it, but it should be
                // removed from the set of Security Group pairs.
                // Another one of the orphans was one with a conflicting
                // name.  Since no Security Groups was created, there was
                // none to delete.
                // The other two are expected to be deleted.
                var expectedDeletedGroupIds = ['sg-55555555', 'sg-66666666' ];
                _validateAllPairsComplete(test, that.securityGroupPairs);
                test.equals(that.securityGroupPairs.length, that.originalSecurityGroupPairsCount - expectedDeletedGroupIds.length - 2);
                test.deepEqual(that.deletedGroupIds.sort(), expectedDeletedGroupIds);
                _validateOrphanedVpcDefaultSecurityGroup(test, that.otherVpcSgDefault);
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
            test.equals(that.securityGroupPairs.length, that.originalSecurityGroupPairsCount);

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

            // securityGroupPairs should not have lost anything
            test.equals(that.securityGroupPairs.length, that.originalSecurityGroupPairsCount);

            // Any of the pairs that were trying to establish a new
            // mirror SG in the VPC will have failed
            test.ok(!that.securityGroupPairs[1].vpcSecurityGroup);
            test.ok(!that.securityGroupPairs[2].vpcSecurityGroup);
            test.ok(!that.securityGroupPairs[5].vpcSecurityGroup);
            test.equals(Tags.getResourceTagValue(that.securityGroupPairs[1].classicSecurityGroup, Tags.COPYTAG_CLASSIC_SG_KEY), undefined);
            test.equals(Tags.getResourceTagValue(that.securityGroupPairs[2].classicSecurityGroup, Tags.COPYTAG_CLASSIC_SG_KEY), undefined);
            test.equals(Tags.getResourceTagValue(that.securityGroupPairs[5].classicSecurityGroup, Tags.COPYTAG_CLASSIC_SG_KEY), undefined);

            // Two of them -- the ones that were trying to create new
            // Security Groups -- will need to be cleaned up.
            // The third was a default Security Group, which does not
            // need to be cleaned up.
            test.equals(that.deletedGroupIds.length, 2);

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

            // Expect: All pairs are complete.
            // But only one of them got successfully deleted.  Of the
            // others, one is a default Security Group and isn't
            // deletable; the other we forced to fail deletion in this
            // test.
            _validateAllPairsComplete(test, that.securityGroupPairs);
            test.deepEqual(that.deletedGroupIds, ['sg-66666666']);
        });
        test.done();
    }
};

function _validatePair(test, pair, expectedClassicSgId, expectedVpcSgId, expectedVpcId) {
    test.ok(!pair.error);

    test.equals(pair.classicSecurityGroup.GroupId, expectedClassicSgId);
    if (expectedVpcSgId) {
        test.equals(Tags.getResourceTagValue(pair.classicSecurityGroup, Tags.COPYTAG_CLASSIC_SG_KEY), expectedVpcSgId);
    } else {
        test.ok(Tags.getResourceTagValue(pair.classicSecurityGroup, Tags.COPYTAG_CLASSIC_SG_KEY));
    }

    test.equals(pair.vpcSecurityGroup.VpcId, expectedVpcId);
    if (expectedVpcSgId) {
        test.equals(pair.vpcSecurityGroup.GroupId, expectedVpcSgId);
    } else {
        test.ok(pair.vpcSecurityGroup.GroupId);
    }
    test.equals(Tags.getResourceTagValue(pair.vpcSecurityGroup, Tags.COPYTAG_VPC_SG_KEY), expectedClassicSgId);
}

// When a VPC's default Security Group gets orphaned, expect that we
// have cleaned up all our tags.
function _validateOrphanedVpcDefaultSecurityGroup(test, vpcSecurityGroup) {
    var tags = [
        Tags.COPYTAG_VPC_SG_KEY,
        Tags.UPDATE_TIMESTAMP_TAG_KEY,
        Tags.LAST_ERROR_TAG_KEY
    ];
    tags.forEach(function(tag) {
        test.ok(!Tags.getResourceTagValue(vpcSecurityGroup, tag));
    });
}

// After CleanupOrphanedSecurityGroups, all pairs must be complete
function _validateAllPairsComplete(test, pairs) {
    pairs.forEach(function(pair) {
        test.ok(pair.classicSecurityGroup);
        test.ok(pair.vpcSecurityGroup);
    });
}
