/*
 * Copyright 2016 Amazon.com, Inc. or its affiliates. All Rights Reserved.
 *
 * SPDX-License-Identifier: MIT-0
 */

var Tags = require('../lib/tags.js');

module.exports = function SecurityGroupMock(id) {
    this.GroupId = id;
    this.GroupName = 'Name-' + id;
    this.OwnerId = '111122223333';
    this.Description = 'Description-' + id;
    this.IpPermissions = [];
    this.IpPermissionsEgress = [];
    this.Tags = [];

    this.withGroupName = function(groupName) {
        this.GroupName = groupName;
        return this;
    };

    this.withDescription = function(description) {
        this.Description = description;
        return this;
    };

    this.withTag = function(key, value) {
        this.Tags.push({Key: key, Value: value});
        return this;
    };

    this.withLinkToVpc = function(vpcId) {
        return this.withTag(Tags.LINK_TO_VPC_TAG_KEY, vpcId);
    };

    this.withVpcId = function(vpcId) {
        this.VpcId = vpcId;
        return this;
    };

    this.withCopiedFromClassic = function(classicSgId) {
        return this.withTag(Tags.COPYTAG_VPC_SG_KEY, classicSgId);
    };

    this.withCopiedToVpc = function(vpcSgId) {
        return this.withTag(Tags.COPYTAG_CLASSIC_SG_KEY, vpcSgId);
    };

    var makeIpPermission = function(params) {
        return {
            PrefixListIds: [],
            IpProtocol: 'tcp',
            FromPort: (params && params.fromPort) || 3000,
            ToPort: (params && params.toPort) || 3000,
            IpRanges: [],
            UserIdGroupPairs: [],
            PrefixListIds: []
        };
    };

    this.withPermissions = function(params) {
        var ipPermission = makeIpPermission(params);
        if (params.cidrs) {
            ipPermission.IpRanges = params.cidrs.map(function(cidr) {
                return { CidrIp: cidr };
            });
        }
        var ownerId = this.OwnerId;
        var vpcId = this.VpcId;
        if (params.groupIds) {
            ipPermission.UserIdGroupPairs = params.groupIds.map(function(groupId) {
                var userIdGroupPair = {
                    UserId: ownerId,
                    GroupId: groupId
                };
                if (!vpcId) {
                    userIdGroupPair.GroupName = 'Name-' + groupId;
                }
                return userIdGroupPair;
            });
        }
        this.IpPermissions.push(ipPermission);
        return this;
    };

    this.withPrefixListPermissions = function(params) {
        var ipPermission = makeIpPermission(params);
        ipPermission.PrefixListIds = params.prefixListIds.slice();
        this.IpPermissions.push(ipPermission);
        return this;
    };

    function portProtocolString(ipPermission) {
        return ipPermission.FromPort + '-' + ipPermission.ToPort + '/' + ipPermission.IpProtocol;
    }

    // Makes test deepEquals easier by sorting the arrays of CIDR
    // ranges and Security Groups, as well as the array of permissions,
    // deterministically.
    this.sortIpPermissions = function() {
        this.IpPermissions.forEach(function(ipPermission) {
            ipPermission.IpRanges.sort(function(a,b) { return a.CidrIp.localeCompare(b.CidrIp); });
            ipPermission.UserIdGroupPairs.sort(function(a,b) { return a.GroupId.localeCompare(b.GroupId); });
        });
        this.IpPermissions.sort(function(a,b) {
            return portProtocolString(a).localeCompare(portProtocolString(b));
        });
        return this;
    };

};
