/*
 * Copyright 2016 Amazon.com, Inc. or its affiliates. All Rights Reserved.
 *
 * SPDX-License-Identifier: MIT-0
 */

var syncSecurityGroupRules = require('../lib/sync_security_group_rules.js');
var Tags = require('../lib/tags.js');
var Ec2Mock = require('./ec2mock.js');
var SgMock = require('./sgmock.js');

exports.setUp = function(callback) {
    this.ec2mock = new Ec2Mock();
    callback();
};

exports.syncSecurityGroupRules = {
    setUp: function(callback) {
        this.vpcId = 'vpc-11111111';
        this.ec2mock.securityGroups = [];

        // Pair 1: Already in sync
        this.classicSg1a = new SgMock('sg-1111111a')
            .withLinkToVpc(this.vpcId)
            .withCopiedToVpc('sg-1111111b')
            .withPermissions({cidrs: ['4.3.2.0/24', '1.2.3.0/24'], groupIds: ['sg-2222222a', 'sg-1111111a']});
        this.vpcSg1b = new SgMock('sg-1111111b')
            .withVpcId(this.vpcId)
            .withCopiedFromClassic('sg-1111111a')
            .withPermissions({cidrs: ['1.2.3.0/24', '4.3.2.0/24'], groupIds: ['sg-1111111b', 'sg-2222222b']})
            .withPrefixListPermissions({prefixListIds: ['pl-12341234', 'pl-43214321']});
        this.vpcSg1bExpected = new SgMock('sg-1111111b')
            .withVpcId(this.vpcId)
            .withCopiedFromClassic('sg-1111111a')
            .withPermissions({cidrs: ['1.2.3.0/24', '4.3.2.0/24'], groupIds: ['sg-1111111b', 'sg-2222222b']})
            .withPrefixListPermissions({prefixListIds: ['pl-12341234', 'pl-43214321']});
        this.ec2mock.securityGroups.push(this.classicSg1a, this.vpcSg1b);

        // Pair 2: Needs something added and something removed
        this.classicSg2a = new SgMock('sg-2222222a')
            .withLinkToVpc(this.vpcId)
            .withCopiedToVpc('sg-2222222b')
            .withPermissions({fromPort: 1111, toPort: 1112, cidrs: ['1.2.3.4/32']})
            .withPermissions({fromPort: 2222, toPort: 2223, cidrs: ['2.3.4.5/32', '3.4.5.6/32']})
            .withPermissions({fromPort: 4444, toPort: 4445, groupIds: ['sg-2222222a']})
            .withPermissions({fromPort: 5555, toPort: 5556, groupIds: ['sg-1111111a', 'sg-2222222a']});
        this.vpcSg2b = new SgMock('sg-2222222b')
            .withVpcId(this.vpcId)
            .withCopiedFromClassic('sg-2222222a')
            .withPermissions({fromPort: 2222, toPort: 2223, cidrs: ['3.4.5.6/32', '4.5.6.7/32']})
            .withPermissions({fromPort: 3333, toPort: 3334, cidrs: ['5.6.7.8/32']})
            .withPermissions({fromPort: 5555, toPort: 5556, groupIds: ['sg-2222222b', 'sg-3333333b']})
            .withPermissions({fromPort: 6666, toPort: 6667, groupIds: ['sg-3333333b']})
            .withPrefixListPermissions({prefixListIds: ['pl-00000000']});
        this.vpcSg2bExpected = new SgMock('sg-2222222b')
            .withVpcId(this.vpcId)
            .withCopiedFromClassic('sg-2222222a')
            .withPermissions({fromPort: 1111, toPort: 1112, cidrs: ['1.2.3.4/32']})
            .withPermissions({fromPort: 2222, toPort: 2223, cidrs: ['2.3.4.5/32', '3.4.5.6/32']})
            .withPermissions({fromPort: 4444, toPort: 4445, groupIds: ['sg-2222222b']})
            .withPermissions({fromPort: 5555, toPort: 5556, groupIds: ['sg-1111111b', 'sg-2222222b']});
        this.ec2mock.securityGroups.push(this.classicSg2a, this.vpcSg2b);

        // Pair 3: Classic SG references another copied SG
        this.classicSg3a = new SgMock('sg-3333333a')
            .withLinkToVpc(this.vpcId)
            .withCopiedToVpc('sg-3333333b')
            .withPermissions({groupIds: ['sg-1111111a', 'sg-3333333a', 'sg-ffffffff']});
        this.vpcSg3b = new SgMock('sg-3333333b')
            .withVpcId(this.vpcId)
            .withCopiedFromClassic('sg-3333333a');
        this.vpcSg3bExpected = new SgMock('sg-3333333b')
            .withVpcId(this.vpcId)
            .withCopiedFromClassic('sg-3333333a')
            .withPermissions({groupIds: ['sg-1111111b', 'sg-3333333b']});
        this.ec2mock.securityGroups.push(this.classicSg3a, this.vpcSg3b);

        // Pair 4: Classic SG references an SG that isn't copied to the
        //         same VPC
        this.classicSg4a = new SgMock('sg-4444444a')
            .withLinkToVpc(this.vpcId)
            .withCopiedToVpc('sg-4444444b')
            .withPermissions({groupIds: ['sg-4444444c']});
        this.vpcSg4b = new SgMock('sg-4444444b')
            .withVpcId(this.vpcId)
            .withCopiedFromClassic('sg-4444444a');
        this.vpcSg4bExpected = new SgMock('sg-4444444b')
            .withVpcId(this.vpcId)
            .withCopiedFromClassic('sg-4444444a');
        this.classicSg4c = new SgMock('sg-4444444c')
            .withLinkToVpc('vpc-22222222');
        this.ec2mock.securityGroups.push(this.classicSg4a, this.vpcSg4b, this.classicSg4c);

        // Pair 5: Revoke one of multiple CIDRs, one of multiple
        //         SG references
        this.classicSg5a = new SgMock('sg-5555555a')
            .withLinkToVpc(this.vpcId)
            .withCopiedToVpc('sg-5555555b')
            .withPermissions({
                fromPort: 22,
                toPort: 22,
                cidrs: ['1.2.3.0/24', '3.4.5.0/24'],
                groupIds: ['sg-3333333a']
            });
        this.vpcSg5b = new SgMock('sg-5555555b')
            .withVpcId(this.vpcId)
            .withCopiedFromClassic('sg-5555555a')
            .withPermissions({
                fromPort: 22,
                toPort: 22,
                cidrs: ['1.2.3.0/24', '2.3.4.0/24', '3.4.5.0/24'],
                groupIds: ['sg-1111111b', 'sg-3333333b']
            });
        this.vpcSg5bExpected = new SgMock('sg-5555555b')
            .withVpcId(this.vpcId)
            .withCopiedFromClassic('sg-5555555a')
            .withPermissions({
                fromPort: 22,
                toPort: 22,
                cidrs: ['1.2.3.0/24', '3.4.5.0/24'],
                groupIds: ['sg-3333333b']
            });
        this.ec2mock.securityGroups.push(this.classicSg5a, this.vpcSg5b);

        // Pair 6: Change a port
        this.classicSg6a = new SgMock('sg-6666666a')
            .withLinkToVpc(this.vpcId)
            .withCopiedToVpc('sg-6666666b')
            .withPermissions({
                fromPort:4000,
                toPort:4000,
                cidrs: ['1.2.3.0/24'],
                groupIds: ['sg-6666666a']
            });
        this.vpcSg6b = new SgMock('sg-6666666b')
            .withVpcId(this.vpcId)
            .withCopiedFromClassic('sg-6666666a')
            .withPermissions({
                fromPort:4001,
                toPort:4001,
                cidrs: ['1.2.3.0/24'],
                groupIds: ['sg-6666666b']
            });
        this.vpcSg6bExpected = new SgMock('sg-6666666b')
            .withVpcId(this.vpcId)
            .withCopiedFromClassic('sg-6666666a')
            .withPermissions({
                fromPort:4000,
                toPort:4000,
                cidrs: ['1.2.3.0/24'],
                groupIds: ['sg-6666666b']
            });
        this.ec2mock.securityGroups.push(this.classicSg6a, this.vpcSg6b);

        // Pair 7: In sync; Classic Security Group has references to
        //         other Classic Security Groups that aren't mirrored;
        //         those shouldn't get propagated.
        this.classicSg7a = new SgMock('sg-7777777a')
            .withLinkToVpc(this.vpcId)
            .withCopiedToVpc('sg-7777777b')
            .withPermissions({
                fromPort: 22,
                toPort: 22,
                cidrs: ['192.168.45.67/32']
            }).withPermissions({
                fromPort: 80,
                toPort: 80,
                groupIds: ['sg-otherclassic']
            }).withPermissions({
                fromPort: 8080,
                toPort: 8080,
                groupIds: ['sg-otherclassic2']
            }).withPermissions({
                fromPort: 49152,
                toPort: 49153,
                groupIds: ['sg-6666666a']
            });
        this.vpcSg7b = new SgMock('sg-7777777b')
            .withVpcId(this.vpcId)
            .withCopiedFromClassic('sg-7777777a')
            .withPermissions({
                fromPort: 22,
                toPort: 22,
                cidrs: ['192.168.45.67/32']
            }).withPermissions({
                fromPort: 49152,
                toPort: 49153,
                groupIds: ['sg-6666666b']
            });
        this.vpcSg7bExpected = new SgMock('sg-7777777b')
            .withVpcId(this.vpcId)
            .withCopiedFromClassic('sg-7777777a')
            .withPermissions({
                fromPort: 22,
                toPort: 22,
                cidrs: ['192.168.45.67/32']
            }).withPermissions({
                fromPort: 49152,
                toPort: 49153,
                groupIds: ['sg-6666666b']
            });
        this.ec2mock.securityGroups.push(this.classicSg7a, this.vpcSg7b);

        // Pair 8: VPC Security Group has a reference to another mirrored
        //         VPC Security Group; Classic Security Group appears
        //         no longer to have that reference.  Expect that the
        //         reference be removed.
        this.classicSg8a = new SgMock('sg-8888888a')
            .withLinkToVpc(this.vpcId)
            .withCopiedToVpc('sg-8888888b')
            .withPermissions({fromPort: 3001, toPort: 3001, groupIds: ['sg-8888888a']});
        this.vpcSg8b = new SgMock('sg-8888888b')
            .withVpcId(this.vpcId)
            .withCopiedFromClassic('sg-8888888a')
            .withPermissions({groupIds: ['sg-3333333b']})
            .withPermissions({fromPort: 3001, toPort: 3001, groupIds: ['sg-3333333b', 'sg-8888888b']});
        this.vpcSg8bExpected = new SgMock('sg-8888888b')
            .withVpcId(this.vpcId)
            .withCopiedFromClassic('sg-8888888a')
            .withPermissions({fromPort: 3001, toPort: 3001, groupIds: ['sg-8888888b']});
        this.ec2mock.securityGroups.push(this.classicSg8a, this.vpcSg8b);

        // Pair 9: VPC Security Group has a reference to another VPC
        //         Security Group that is not managed by ClassicLink
        //         Mirror.
        //         It should not get revoked.
        this.classicSg9a = new SgMock('sg-9999999a')
            .withLinkToVpc(this.vpcId)
            .withCopiedToVpc('sg-9999999b')
            .withPermissions({groupIds: ['sg-9999999a']});
        this.vpcSg9b = new SgMock('sg-9999999b')
            .withVpcId(this.vpcId)
            .withCopiedFromClassic('sg-9999999a')
            .withPermissions({groupIds: ['sg-9999999b', 'sg-9999999c']})
            .withPermissions({fromPort: 3001, toPort: 3001, groupIds: ['sg-9999999d']});
        this.vpcSg9bExpected = new SgMock('sg-9999999b')
            .withVpcId(this.vpcId)
            .withCopiedFromClassic('sg-9999999a')
            .withPermissions({groupIds: ['sg-9999999b', 'sg-9999999c']})
            .withPermissions({fromPort: 3001, toPort: 3001, groupIds: ['sg-9999999d']});
        this.ec2mock.securityGroups.push(this.classicSg9a, this.vpcSg9b);

        this.securityGroupPairs = [
            { classicSecurityGroup: this.classicSg1a, vpcSecurityGroup: this.vpcSg1b },
            { classicSecurityGroup: this.classicSg2a, vpcSecurityGroup: this.vpcSg2b },
            { classicSecurityGroup: this.classicSg3a, vpcSecurityGroup: this.vpcSg3b },
            { classicSecurityGroup: this.classicSg4a, vpcSecurityGroup: this.vpcSg4b },
            { classicSecurityGroup: this.classicSg5a, vpcSecurityGroup: this.vpcSg5b },
            { classicSecurityGroup: this.classicSg6a, vpcSecurityGroup: this.vpcSg6b },
            { classicSecurityGroup: this.classicSg7a, vpcSecurityGroup: this.vpcSg7b },
            { classicSecurityGroup: this.classicSg8a, vpcSecurityGroup: this.vpcSg8b },
            { classicSecurityGroup: this.classicSg9a, vpcSecurityGroup: this.vpcSg9b }
        ];

        callback();
    },

    testSyncRules: function(test) {
        syncSecurityGroupRules.init(this.ec2mock);
        var that = this;
        var expectations = [
            { actual: that.vpcSg1b, expected: that.vpcSg1bExpected },
            { actual: that.vpcSg2b, expected: that.vpcSg2bExpected },
            { actual: that.vpcSg3b, expected: that.vpcSg3bExpected },
            { actual: that.vpcSg4b, expected: that.vpcSg4bExpected },
            { actual: that.vpcSg5b, expected: that.vpcSg5bExpected },
            { actual: that.vpcSg6b, expected: that.vpcSg6bExpected },
            { actual: that.vpcSg7b, expected: that.vpcSg7bExpected },
            { actual: that.vpcSg8b, expected: that.vpcSg8bExpected },
            { actual: that.vpcSg9b, expected: that.vpcSg9bExpected }
        ];
        syncSecurityGroupRules.syncSecurityGroupRules(this.securityGroupPairs, function(err, data) {
            test.ok(!err, 'syncSecurityGroupRules error: ' + err);
            expectations.forEach(function(pair) {

                var errorTag = Tags.getResourceTagValue(pair.actual, Tags.LAST_ERROR_TAG_KEY);
                test.ok(!errorTag, pair.actual.GroupId + ' unexpected error tag ' + errorTag);

                var updateTimestamp = Tags.getResourceTagValue(pair.actual, Tags.UPDATE_TIMESTAMP_TAG_KEY);
                test.ok(updateTimestamp, pair.actual.GroupId + ' missing update tag');

                // Set this tag on the expected SG
                pair.expected.withTag(Tags.UPDATE_TIMESTAMP_TAG_KEY, updateTimestamp);

                console.log('Validating ' + pair.actual.GroupId);
                pair.actual.sortIpPermissions();
                pair.expected.sortIpPermissions();
                test.deepEqual(pair.actual.IpPermissions, pair.expected.IpPermissions, pair.actual.GroupId + " mismatch ip permissions\nactual   " + JSON.stringify(pair.actual.IpPermissions) + "\nexpected " + JSON.stringify(pair.expected.IpPermissions));

            });
            data.forEach(function(pair) { test.ok(!pair.error); });
            test.done();
        });
    },

    testSyncRulesFail: function(test) {
        // Set up another pair of security groups; there is something new
        // to authorize, but force it to fail
        var failedGroupId = 'sg-FAIL-b';
        var classicSgFail = new SgMock('sg-FAIL-a')
            .withLinkToVpc(this.vpcId)
            .withCopiedToVpc(failedGroupId)
            .withPermissions({cidrs: ['1.2.3.0/24', '2.3.4.0/24']});
        var vpcSgFail = new SgMock('sg-FAIL-b')
            .withCopiedFromClassic('sg-FAIL-a');
        this.ec2mock.securityGroups.push(classicSgFail, vpcSgFail);

        // Make a fake error string and then bloat it so that it's too
        // long for a tag value.
        var forcedError = 'FAIL injected error'.repeat(100);

        var _authorizeSecurityGroupIngress = this.ec2mock.authorizeSecurityGroupIngress.bind(this.ec2mock);
        var that = this;
        this.ec2mock.authorizeSecurityGroupIngress = function(params, callback) {
            if (params.GroupId == failedGroupId) {
                console.log('FAILING authorizeSecurityGroupIngress ' + JSON.stringify(params));
                callback(forcedError);
            } else {
                _authorizeSecurityGroupIngress(params, callback);
            }
        };
        syncSecurityGroupRules.init(this.ec2mock);

        syncSecurityGroupRules.syncSecurityGroupRules([{classicSecurityGroup: classicSgFail, vpcSecurityGroup: vpcSgFail}], function(err, data) {
            test.ok(!err);
            test.ok(data[0].error);
            test.ok(Tags.getResourceTagValue(vpcSgFail, Tags.UPDATE_TIMESTAMP_TAG_KEY));
            var lastError = Tags.getResourceTagValue(vpcSgFail, Tags.LAST_ERROR_TAG_KEY);
            test.ok(lastError);
            test.ok(lastError.length > 0);
            test.ok(lastError.length < 255);
            test.done();
        });
    }

};

