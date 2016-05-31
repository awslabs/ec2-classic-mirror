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

var linkInstances = require('../lib/link_instances.js');
var Tags = require('../lib/tags.js');
var Ec2Mock = require('./ec2mock.js');
var SgMock = require('./sgmock.js');
var InstanceMock = require('./instancemock.js');

exports.setUp = function(callback) {
    this.ec2mock = new Ec2Mock();
    callback();
};

exports.linkInstances = {
    setUp: function(callback) {
       this.vpcId = 'vpc-11111111';
       this.ec2mock.instances = [];
       this.ec2mock.securityGroups = [];
       this.testExpectations = {};

       // Pair 1: Already in sync
       this.classicSg1a = new SgMock('sg-1111111a').withLinkToVpc(this.vpcId);
       this.vpcSg1b = new SgMock('sg-1111111b').withVpcId(this.vpcId);
       this.ec2mock.securityGroups.push(this.classicSg1a, this.vpcSg1b);
       this.instance1_0 = new InstanceMock('i-11111110')
           .withSecurityGroup(this.classicSg1a)
           .withClassicLink(this.vpcId, [this.vpcSg1b.GroupId]);
       this.testExpectations[this.instance1_0.InstanceId] = {
           instance: this.instance1_0,
           linkedGroupIds: [this.vpcSg1b.GroupId]
       };
       this.instance1_1 = new InstanceMock('i-11111111')
           .withSecurityGroup(this.classicSg1a)
           .withClassicLink(this.vpcId, [this.vpcSg1b.GroupId]);
       this.testExpectations[this.instance1_1.InstanceId] = {
          instance: this.instance1_1,
          linkedGroupIds: [this.vpcSg1b.GroupId]
       };
       this.ec2mock.instances.push(this.instance1_0, this.instance1_1);

       // Pair 2: Some instances need to be linked
       this.classicSg2a = new SgMock('sg-2222222a').withLinkToVpc(this.vpcId);
       this.vpcSg2b = new SgMock('sg-2222222b').withVpcId(this.vpcId);
       this.ec2mock.securityGroups.push(this.classicSg2a, this.vpcSg2b);
       this.instance2_0 = new InstanceMock('i-22222220')
           .withSecurityGroup(this.classicSg2a);
       this.testExpectations[this.instance2_0.InstanceId] = {
           instance: this.instance2_0,
           attachClassicLinkVpc: true,
           linkedGroupIds: [this.vpcSg2b.GroupId]
       };
       this.instance2_1 = new InstanceMock('i-22222221')
           .withSecurityGroup(this.classicSg2a)
           .withClassicLink(this.vpcId, [this.vpcSg2b.GroupId]);
       this.testExpectations[this.instance2_1.InstanceId] = {
           instance: this.instance2_1,
           linkedGroupIds: [this.vpcSg2b.GroupId]
       };
       this.instance2_2 = new InstanceMock('i-22222222')
           .withSecurityGroup(this.classicSg2a);
       this.testExpectations[this.instance2_2.InstanceId] = {
           instance: this.instance2_2,
           attachClassicLinkVpc: true,
           linkedGroupIds: [this.vpcSg2b.GroupId]
       };
       this.instance2_3 = new InstanceMock('i-22222223')
           .withSecurityGroup(this.classicSg2a)
           .terminate();
       this.testExpectations[this.instance2_3.InstanceId] = {
           instance: this.instance2_3,
           linkedGroupIds: []
       };
       this.instance2_4 = new InstanceMock('i-22222224')
           .withSecurityGroup(this.classicSg2a)
           .withSecurityGroup(this.classicSg1a);
       this.testExpectations[this.instance2_4.InstanceId] = {
            instance: this.instance2_4,
            attachClassicLinkVpc: true,
            linkedGroupIds: [this.vpcSg1b.GroupId, this.vpcSg2b.GroupId]
       };
       this.ec2mock.instances.push(this.instance2_0, this.instance2_1, this.instance2_2, this.instance2_3, this.instance2_4);

       // Pair 3: Extra instances appear to be linked
       this.classicSg3a = new SgMock('sg-3333333a').withLinkToVpc(this.vpcId);
       this.classicSg3Other = new SgMock('sg-333other');
       this.vpcSg3b = new SgMock('sg-3333333b').withVpcId(this.vpcId);
       this.ec2mock.securityGroups.push(this.classicSg3a, this.classicSg3Other, this.vpcSg3b);
       this.instance3_0 = new InstanceMock('i-33333330')
           .withSecurityGroup(this.classicSg3a);
       this.testExpectations[this.instance3_0.InstanceId] = {
           instance: this.instance3_0,
           attachClassicLinkVpc: true,
           linkedGroupIds: [this.vpcSg3b.GroupId]
       };
       this.instance3_1 = new InstanceMock('i-33333331')
           .withSecurityGroup(this.classicSg3Other)
           .withClassicLink(this.vpcId, [this.vpcSg3b.GroupId]);
       this.testExpectations[this.instance3_1.InstanceId] = {
           instance: this.instance3_1,
           linkedGroupIds: [this.vpcSg3b.GroupId]
       };
       this.instance3_2 = new InstanceMock('i-33333332')
           .withSecurityGroup(this.classicSg3a)
           .withSecurityGroup(this.classicSg3Other)
           .withClassicLink(this.vpcId, [this.vpcSg3b.GroupId]);
       this.testExpectations[this.instance3_2.InstanceId] = {
           instance: this.instance3_2,
           linkedGroupIds: [this.vpcSg3b.GroupId]
       };
       this.ec2mock.instances.push(this.instance3_0, this.instance3_1, this.instance3_2);

       // Pair 4: Some instance linked elsewhere
       this.classicSg4a = new SgMock('sg-4444444a').withLinkToVpc(this.vpcId);
       this.vpcSg4b = new SgMock('sg-4444444b').withVpcId(this.vpcId);
       this.ec2mock.securityGroups.push(this.classicSg4a, this.vpcSg4b);
       this.instance4_0 = new InstanceMock('i-44444440')
           .withSecurityGroup(this.classicSg4a)
           .withClassicLink(this.vpcId, [this.vpcSg3b.GroupId]);
       this.testExpectations[this.instance4_0.InstanceId] = {
           instance: this.instance4_0,
           detachClassicLinkVpc: true,
           attachClassicLinkVpc: true,
           linkedGroupIds: [this.vpcSg4b.GroupId]
       };
       this.ec2mock.instances.push(this.instance4_0);

       // Pair 5: No instances
       this.classicSg5a = new SgMock('sg-5555555a').withLinkToVpc(this.vpcId);
       this.vpcSg5b = new SgMock('sg-5555555b').withVpcId(this.vpcId);
       this.ec2mock.securityGroups.push(this.classicSg5a, this.vpcSg5b);

       // Pair 6: No VPC SG
       this.classicSg6a = new SgMock('sg-6666666a');
       this.ec2mock.securityGroups.push(this.classicSg6a);
       this.instance6_0 = new InstanceMock('i-66666660')
           .withSecurityGroup(this.classicSg6a)
           .withClassicLink(this.vpcId, [this.vpcSg3b.GroupId]);
       this.testExpectations[this.instance6_0.InstanceId] = {
          instance: this.instance6_0,
          linkedGroupIds: [this.vpcSg3b.GroupId]
       };
       this.ec2mock.instances.push(this.instance6_0);

       // Pair 7: No Classic SG
       this.vpcSg7b = new SgMock('sg-7777777b');
       this.ec2mock.securityGroups.push(this.vpcSg7b);

       // Pair 8: Classic instance is a member of two different Security
       // Groups
       this.classicSg8a = new SgMock('sg-8888888a').withLinkToVpc(this.vpcId);
       this.vpcSg8b = new SgMock('sg-8888888b').withVpcId(this.vpcId);
       this.ec2mock.securityGroups.push(this.classicSg8a, this.vpcSg8b);
       this.instance8_0 = new InstanceMock('i-88888880')
           .withSecurityGroup(this.classicSg2a)
           .withSecurityGroup(this.classicSg8a);
       this.testExpectations[this.instance8_0.InstanceId] = {
           instance: this.instance8_0,
           attachClassicLinkVpc: true,
           linkedGroupIds: [this.vpcSg2b.GroupId, this.vpcSg8b.GroupId]
       };
       this.instance8_1 = new InstanceMock('i-88888881')
           .withSecurityGroup(this.classicSg3a)
           .withSecurityGroup(this.classicSg8a)
           .withClassicLink(this.vpcId, [this.vpcSg8b.GroupId]);
       this.testExpectations[this.instance8_1.InstanceId] = {
           instance: this.instance8_1,
           detachClassicLinkVpc: true,
           attachClassicLinkVpc: true,
           linkedGroupIds: [this.vpcSg3b.GroupId, this.vpcSg8b.GroupId]
       };
       this.instance8_2 = new InstanceMock('i-88888882')
           .withSecurityGroup(this.classicSg4a)
           .withSecurityGroup(this.classicSg8a)
           .withClassicLink(this.vpcId, [this.vpcSg4b.GroupId, this.vpcSg8b.GroupId]);
       this.instance8_3 = new InstanceMock('i-88888883')
           .withSecurityGroup(this.classicSg5a)
           .withSecurityGroup(this.classicSg6a)
           .withSecurityGroup(this.classicSg8a)
           .withClassicLink(this.vpcId, [this.vpcSg5b.GroupId]);
       this.testExpectations[this.instance8_3.InstanceId] = {
           instance: this.instance8_3,
           detachClassicLinkVpc: true,
           attachClassicLinkVpc: true,
           linkedGroupIds: [this.vpcSg5b.GroupId, this.vpcSg8b.GroupId]
       };
       this.ec2mock.instances.push(this.instance8_0, this.instance8_1, this.instance8_2, this.instance8_3);

       // Pair 9: An instance that's trying to link to two different VPCs
       this.otherVpcId = 'vpc-22222222';
       this.classicSg9a = new SgMock('sg-9999999a').withLinkToVpc(this.vpcId);
       this.vpcSg9b = new SgMock('sg-9999999b').withVpcId(this.vpcId);
       this.classicSg9c = new SgMock('sg-9999999c').withLinkToVpc(this.otherVpcId);
       this.vpcSg9d = new SgMock('sg-9999999d').withVpcId(this.otherVpcId);
       this.ec2mock.securityGroups.push(this.classicSg9a, this.vpcSg9b, this.classicSg9c, this.vpcSg9d);
       this.instance9_0 = new InstanceMock('i-99999990')
           .withSecurityGroup(this.classicSg9a)
           .withSecurityGroup(this.classicSg9c);
       this.testExpectations[this.instance9_0.InstanceId] = {
           instance: this.instance9_0,
           linkedGroupIds: []
       };
       this.ec2mock.instances.push(this.instance9_0);

       this.securityGroupPairs = [
       { classicSecurityGroup: this.classicSg1a, vpcSecurityGroup: this.vpcSg1b },
       { classicSecurityGroup: this.classicSg2a, vpcSecurityGroup: this.vpcSg2b },
       { classicSecurityGroup: this.classicSg3a, vpcSecurityGroup: this.vpcSg3b },
       { classicSecurityGroup: this.classicSg4a, vpcSecurityGroup: this.vpcSg4b },
       { classicSecurityGroup: this.classicSg5a, vpcSecurityGroup: this.vpcSg5b },
       { classicSecurityGroup: this.classicSg6a, vpcSecurityGroup: this.vpcSg6b },
       { classicSecurityGroup: this.classicSg7a, vpcSecurityGroup: this.vpcSg7b },
       { classicSecurityGroup: this.classicSg8a, vpcSecurityGroup: this.vpcSg8b },
       { classicSecurityGroup: this.classicSg9a, vpcSecurityGroup: this.vpcSg9b },
       { classicSecurityGroup: this.classicSg9c, vpcSecurityGroup: this.vpcSg9d } ];

       callback();
    },

    testLinkInstances: function(test) {

        // Wrap ec2.attachClassicLinkVpc so that we can track which
        // instances it was called for.
        var attachClassicLinkVpcCallMap = {};
        var _attachClassicLinkVpc = this.ec2mock.attachClassicLinkVpc.bind(this.ec2mock);
        this.ec2mock.attachClassicLinkVpc = function(params, callback) {
            attachClassicLinkVpcCallMap[params.InstanceId] = params;
            _attachClassicLinkVpc(params, callback);
        };

        // Same thing for ec2.detachClassicLinkVpc
        var detachClassicLinkVpcCallMap = {};
        var _detachClassicLinkVpc = this.ec2mock.detachClassicLinkVpc.bind(this.ec2mock);
        this.ec2mock.detachClassicLinkVpc = function(params, callback) {
            detachClassicLinkVpcCallMap[params.InstanceId] = params;
            _detachClassicLinkVpc(params, callback);
        };

        linkInstances.init(this.ec2mock);

        var that = this;
        linkInstances.linkInstances(this.securityGroupPairs, function(err, data) {
            test.ok(!err, 'linkInstances unexpected error');

            for (var instanceId in that.testExpectations) {
                var expectation = that.testExpectations[instanceId];
                console.log('Validating ' + instanceId + ' against ' + JSON.stringify(expectation));

                // Validate that attachClassicLinkVpc either was or
                // wasn't called
                var attachClassicLinkVpcParams = attachClassicLinkVpcCallMap[instanceId];
                if (expectation.attachClassicLinkVpc) {
                    test.ok(attachClassicLinkVpcParams, instanceId + ' missing attachClassicLinkVpc call');
                    test.deepEqual(attachClassicLinkVpcParams.Groups.sort(), expectation.linkedGroupIds.sort(), instanceId + ' incorrect attachClassicLinkVpc params: expected ' + expectation.linkedGroupIds.sort() + '; actual ' + attachClassicLinkVpcParams.Groups.sort());
                } else {
                    test.ok(!attachClassicLinkVpcParams, instanceId + ' unexpected attachClassicLinkVpc call');
                }

                // Validate that detachClassicLinkVpc either was or wasn't
                // called
                var detachClassicLinkVpcParams = detachClassicLinkVpcCallMap[instanceId];
                if (expectation.detachClassicLinkVpc) {
                    test.ok(detachClassicLinkVpcParams, instanceId + ' missing detachClassicLinkVpc call');
                } else {
                    test.ok(!detachClassicLinkVpcParams, instanceId + ' unexpected detachClassicLinkVpc call');
                }

                // Validate error either was or wasn't reported
                var errorTag = Tags.getResourceTagValue(expectation.instance, Tags.LAST_ERROR_TAG_KEY);
                if (expectation.error) {
                    test.ok(errorTag, instanceId + ' missing expected error tag');
                } else {
                    test.ok(!errorTag, instanceId + ' unexpected error tag ' + errorTag);
                }

                // Validate update tag
                var updateTag = Tags.getResourceTagValue(expectation.instance, Tags.UPDATE_TIMESTAMP_TAG_KEY);
                if (expectation.attachClassicLinkVpc || expectation.detachClassicLinkVpc) {
                    test.ok(updateTag, instanceId + ' missing expected update tag');
                } else {
                    test.ok(!updateTag, instanceId + ' unexpected update tag');
                }

                // Look at the instance's ClassicLinks and validate
                // that they match the expectation.
                var classicLinkedGroupIdsActual = [];
                if (expectation.instance.ClassicLink) {
                    classicLinkedGroupIdsActual = expectation.instance.ClassicLink.Groups.map(function(group) {
                        return group.GroupId;
                    }).sort();
                }
                test.deepEqual(classicLinkedGroupIdsActual, expectation.linkedGroupIds.sort(), instanceId + ' incorrect set of ClassicLinks; expected ' + expectation.linkedGroupIds + '; actual ' + classicLinkedGroupIdsActual);
            }
            test.done();
        });
    },

    testFaiLinkInstance: function(test) {
        var failingInstanceId = 'i-FAIL';
        var failingInstance = new InstanceMock(failingInstanceId)
            .withSecurityGroup(this.classicSg2a);
        this.ec2mock.instances.push(failingInstance);

        this.ec2mock.attachClassicLinkVpc = function(params, callback) {
            callback('FAILING attachClassicLinkVpc ' + JSON.stringify(params));
        };
        linkInstances.init(this.ec2mock);

        var that = this;
        linkInstances.linkInstances(this.securityGroupPairs, function(err, data) {
            test.ok(!err, 'Unexpected error ' + err);
            test.ok(Tags.getResourceTagValue(failingInstance, Tags.LAST_ERROR_TAG_KEY), failingInstance.InstanceId + ' missing error tag');
            var expectedFailedTask = data.find(function(x) { return x.instanceId == failingInstanceId });
            test.ok(expectedFailedTask);
            test.ok(expectedFailedTask.error);
            test.done();
        });
    },

    testFailDescribeInstances: function(test) {
        this.ec2mock.describeInstances = function(params, callback) {
            callback('FAILING describeInstances ' + JSON.stringify(params));
        };
        linkInstances.init(this.ec2mock);

        linkInstances.linkInstances(this.securityGroupPairs, function(err, data) {
            test.ok(!err, 'Unexpected error ' + JSON.stringify(err));
            test.done();
        });
    },

    testFailDescribeClassicLinkInstances: function(test) {
        this.ec2mock.describeClassicLinkInstances = function(params, callback) {
            callback('FAILING describeClassicLinkInstances ' + JSON.stringify(params));
        };
        linkInstances.init(this.ec2mock);

        linkInstances.linkInstances(this.securityGroupPairs, function(err, data) {
            test.ok(!err, 'Unexpected error ' + JSON.stringify(err));
            test.done();
        });
    }
};



