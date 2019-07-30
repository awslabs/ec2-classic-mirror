/*
 * Copyright 2016 Amazon.com, Inc. or its affiliates. All Rights Reserved.
 *
 * SPDX-License-Identifier: MIT-0
 */

var describeSecurityGroups = require('../lib/describe_security_groups.js');
var Ec2Mock = require('./ec2mock.js');
var SgMock = require('./sgmock.js');

exports.setUp = function(callback) {
    this.ec2mock = new Ec2Mock();
    callback();
};

exports.describeSecurityGroups = {
    testDescribeSecurityGroups: function(test) {
        this.ec2mock.securityGroups = [
            new SgMock('sg-11111111').withLinkToVpc('vpc-11111111'),
            new SgMock('sg-22222222').withLinkToVpc('vpc-11111111'),
            new SgMock('sg-33333333').withVpcId('vpc-11111111').withCopiedFromClassic('sg-11111111'),
            new SgMock('sg-44444444').withVpcId('vpc-11111111').withCopiedFromClassic('sg-ffffffff'),
            // Invalid: sg-11111111 already has an SG that thinks it's
            // copied from that.
            new SgMock('sg-55555555').withVpcId('vpc-11111111').withCopiedFromClassic('sg-11111111'),
            // Invalid: sg-22222222 thinks it's in a different VPC
            new SgMock('sg-66666666').withVpcId('vpc-22222222').withCopiedFromClassic('sg-11111111')
        ];
        describeSecurityGroups.init(this.ec2mock);
        describeSecurityGroups.describeSecurityGroupPairs(function(err, data) {
            test.ok(!err);
            var actualIds = data.map(function(pair) {
                return {
                    classic: pair.classicSecurityGroup && pair.classicSecurityGroup.GroupId,
                    vpc: pair.vpcSecurityGroup && pair.vpcSecurityGroup.GroupId
                };
            });
            var expectedIds = [
                { classic: 'sg-11111111', vpc: 'sg-33333333' },
                { classic: 'sg-22222222', vpc: undefined },
                { classic: undefined, vpc: 'sg-44444444' },
                { classic: undefined, vpc: 'sg-55555555' },
                { classic: undefined, vpc: 'sg-66666666' }
            ];
            test.deepEqual(actualIds, expectedIds);
            test.done();
        });
    },

    testDescribeSecurityGroupsFail: function(test) {
        this.ec2mock.describeSecurityGroups = function(params, callback) {
            console.log('FAILING ' + JSON.stringify(params));
            callback(new Error('FAIL'));
        };
        describeSecurityGroups.init(this.ec2mock);
        describeSecurityGroups.describeSecurityGroupPairs(function(err, data) {
            test.ok(err);
            test.ok(!data);
            test.done();
        });
    }
};

