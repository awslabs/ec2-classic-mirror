/*
 * Copyright 2016 Amazon.com, Inc. or its affiliates. All Rights Reserved.
 *
 * SPDX-License-Identifier: MIT-0
 */

var Promise = require('promise');
var Tags = require('./tags');

var ec2CreateTags;
var ec2DeleteTags;
var ec2AuthorizeSecurityGroupIngress;
var ec2RevokeSecurityGroupIngress;

// Performs a diff of the ingress Security Group rules for the Classic/VPC
// Security Group pair.
// Authorizes any ingress rules that the Classic Security Group has that
// the VPC Security Group doesn't.
// Revokes any ingress rules that the VPC Security Group has that the
// Classic Security Group doesn't.
// For Security Group rules that reference other Classic Security Groups,
// the rule is synced only if the referenced Classic Security Group is
// also managed by ClassicLink Mirror.

exports.init = function(ec2) {
    ec2CreateTags = Promise.denodeify(ec2.createTags).bind(ec2);
    ec2DeleteTags = Promise.denodeify(ec2.deleteTags).bind(ec2);
    ec2AuthorizeSecurityGroupIngress = Promise.denodeify(ec2.authorizeSecurityGroupIngress).bind(ec2);
    ec2RevokeSecurityGroupIngress = Promise.denodeify(ec2.revokeSecurityGroupIngress).bind(ec2);
};

exports.syncSecurityGroupRules = function(securityGroupPairs, callback) {

    // Create a map of Classic-->VPC Security Group IDs
    var classicToVpcGroupIdMap = {};
    var vpcToClassicGroupIdMap = {};
    securityGroupPairs.forEach(function(pair) {
        if (pair.classicSecurityGroup && pair.vpcSecurityGroup) {
            classicToVpcGroupIdMap[pair.classicSecurityGroup.GroupId] = pair.vpcSecurityGroup.GroupId;
            vpcToClassicGroupIdMap[pair.vpcSecurityGroup.GroupId] = pair.classicSecurityGroup.GroupId;
        }
    });

    var promises = securityGroupPairs.map(function(pair) {
        return _syncSecurityGroupRulesPromise(pair, classicToVpcGroupIdMap, vpcToClassicGroupIdMap);
    });
    return Promise.all(promises)
        .then(function(values) {
            return Promise.resolve(securityGroupPairs);
        }).nodeify(callback);
};

function _syncSecurityGroupRulesPromise(pair, classicToVpcGroupIdMap, vpcToClassicGroupIdMap) {
    console.log('SyncSecurityGroupRules: Syncing ' + pair.classicSecurityGroup.GroupId + ' to ' + pair.vpcSecurityGroup.GroupId);

    // This will diff the IpPermissions on this pair of Security Groups
    // and populate pair.toAuthorize and pair.toRevoke with the rules
    // that need to be authorized/revoked on the VPC side.
    _diffIpPermissions(pair, classicToVpcGroupIdMap, vpcToClassicGroupIdMap);

    // Clean up the IpPermissions structures so that EC2.Authorize/
    // RevokeSecurityGroupIngress will accept them.
    pair.toAuthorize.forEach(_cleanupIpPermission);
    pair.toRevoke.forEach(_cleanupIpPermission);

    // Prepare parameters for Authorize/RevokeSecurityGroupIngress,
    // of which neither, either, or both may be relevant.
    var authorizePromise = Promise.resolve(null);
    var revokePromise = Promise.resolve(null);
    if (pair.toAuthorize.length > 0) {
        var authorizeParams = {
            GroupId: pair.vpcSecurityGroup.GroupId,
            IpPermissions: pair.toAuthorize
        };
        authorizePromise = ec2AuthorizeSecurityGroupIngress(authorizeParams);
    }
    if (pair.toRevoke.length > 0) {
        var revokeParams = {
            GroupId: pair.vpcSecurityGroup.GroupId,
            IpPermissions: pair.toRevoke
        };
        revokePromise = ec2RevokeSecurityGroupIngress(revokeParams);
    }

    return Promise.all([authorizePromise, revokePromise]).then(function(values) {
        // Getting here means that we successfully modified the Security
        // Group rules.  Delete the LastUpdateError tag if it was there.
        var tagParams = {
            Resources: [ pair.vpcSecurityGroup.GroupId ],
            Tags: [ { Key: Tags.LAST_ERROR_TAG_KEY } ]
        };
        return ec2DeleteTags(tagParams);
    }).catch(function(err) {
        // Something failed: Tag with a LastUpdateError tag and continue
        console.error('SyncSecurityGroupRules: Error syncing ' + pair.classicSecurityGroup.GroupId + ' to ' + pair.vpcSecurityGroup.GroupId + ': ' + err);
        pair.error = err;
        var tagParams = {
            Resources: [ pair.vpcSecurityGroup.GroupId ],
            Tags: [ {
                Key: Tags.LAST_ERROR_TAG_KEY,
                Value: Tags.lastErrorTagValue(err)
            } ]
        };
        return ec2CreateTags(tagParams);
    }).then(function() {
        // In any case, mark the time in an LastUpdatedTime tag
        var now = new Date();
        var tagParams = {
            Resources: [ pair.vpcSecurityGroup.GroupId ],
            Tags: [ { Key: Tags.UPDATE_TIMESTAMP_TAG_KEY, Value: now.toISOString() } ]
        };
        return ec2CreateTags(tagParams);
    }).then(function() {
        return Promise.resolve(pair);
    }).catch(function(err) {
        console.error('SyncSecurityGroupRules: Error tagging ' + pair.vpcSecurityGroup.GroupId + ': ' + err);
        return Promise.resolve(pair);
    });
}

// Given a pair, determine the diff.  Writes results in pair.toAuthorize
// and pair.toRevoke.
function _diffIpPermissions(pair, classicToVpcGroupIdMap, vpcToClassicGroupIdMap) {
    var classicPermissionsMap = Map.fromSecurityGroupRuleValues(pair.classicSecurityGroup.IpPermissions);
    var vpcPermissionsMap = Map.fromSecurityGroupRuleValues(pair.vpcSecurityGroup.IpPermissions);

    pair.toAuthorize = [];
    pair.toRevoke = [];

    classicPermissionsMap.minusValues(vpcPermissionsMap).forEach(function(classicIpPermission) {
        // Classic SG has this permission; VPC doesn't.
        // Diff the Classic permission with a blank so that it gets
        // put in the toAuthorize list.
        _diffIpPermission(
            classicIpPermission,
            _copyToBlankPermission(classicIpPermission),
            classicToVpcGroupIdMap,
            vpcToClassicGroupIdMap,
            pair
        );
    });
    vpcPermissionsMap.minusValues(classicPermissionsMap).forEach(function(vpcIpPermission) {
        // VPC SG has this permission; Classic doesn't.
        // Diff a blank permission with the VPC permission so that it
        // gets put in the toRevoke list.
        _diffIpPermission(
            _copyToBlankPermission(vpcIpPermission),
            vpcIpPermission,
            classicToVpcGroupIdMap,
            vpcToClassicGroupIdMap,
            pair
        );
    });
    classicPermissionsMap.intersectValues(vpcPermissionsMap).forEach(function(ipPermissionPair) {
        // Both Classic and VPC have an IpPermission at this protocol/
        // port combination.  Compare the specific rules.
        _diffIpPermission(
            ipPermissionPair[0],
            ipPermissionPair[1],
            classicToVpcGroupIdMap,
            vpcToClassicGroupIdMap,
            pair
        );
    });
}

// Diff a single IpPermission.  This means diffing both IP ranges and
// UserIdGroupPairs references to other Security Groups.  There may be
// some permissions to authorize and some to revoke.
function _diffIpPermission(srcIpPermission, dstIpPermission, classicToVpcGroupIdMap, vpcToClassicGroupIdMap, pair) {

    var authorize = _copyToBlankPermission(srcIpPermission);
    var revoke = _copyToBlankPermission(dstIpPermission);

    srcCidrMap = Map.fromSecurityGroupRuleValues(srcIpPermission.IpRanges);
    dstCidrMap = Map.fromSecurityGroupRuleValues(dstIpPermission.IpRanges);

    // If it's in the source (Classic) rules but not the destination
    // (VPC), we will authorize it.
    // If it's in the destination (VPC) rules but not the source
    // (Classic), we will revoke it.
    authorize.IpRanges = srcCidrMap.minusValues(dstCidrMap);
    revoke.IpRanges = dstCidrMap.minusValues(srcCidrMap);

    // UserIdGroupPairs: Sort on GroupId.  The EC2-Classic Security
    // Groups first need to be mapped to their VPC counterparts, when
    // they exist.
    //
    // For references to EC2-Classic Security Groups that are not
    // managed by ClassicLink Mirror (i.e. not in classicToVpcGroupIdMap),
    // ignore them, because they don't correspond to anything in the VPC.
    //
    // For references to VPC Security Groups that are not managed by
    // ClassicLink Mirror (i.e., not in vpcToClasssicGroupIdMap), ignore
    // them.
    // That means that if we find such a reference in the VPC Security
    // Group, we don't clean it up.  This is to allow scenarios such as
    // allowing a new VPC Elastic Load Balancer Security Group in the VPC,
    // where the Classic equivalent (the amazon-elb-sg group) is not
    // managed by ClassicLink.
    var srcGroupMap = Map.fromSecurityGroupRuleValues(srcIpPermission.UserIdGroupPairs.map(function(groupPair) {
        return {
            UserId: groupPair.UserId,
            GroupId: classicToVpcGroupIdMap[groupPair.GroupId]
        };
    }).filter(function(groupPair) {
        return groupPair.GroupId;
    }));
    var dstGroupMap = Map.fromSecurityGroupRuleValues(dstIpPermission.UserIdGroupPairs.filter(function(groupPair) {
        return vpcToClassicGroupIdMap[groupPair.GroupId];
    }));

    // If it's in the source (Classic) rules but not the destination
    // (VPC), we will authorize it.
    // If it's in the destination (VPC) rules but not the source
    // (Classic), we will revoke it.
    authorize.UserIdGroupPairs = srcGroupMap.minusValues(dstGroupMap);
    revoke.UserIdGroupPairs = dstGroupMap.minusValues(srcGroupMap);

    if ((authorize.IpRanges.length > 0) || (authorize.UserIdGroupPairs.length > 0)) {
        pair.toAuthorize.push(authorize);
        console.log('SyncSecurityGroupRules: ' + pair.classicSecurityGroup.GroupId + '-->' + pair.vpcSecurityGroup.GroupId + ': AUTHORIZE ' + JSON.stringify(authorize));
    }
    if ((revoke.IpRanges.length > 0) || (revoke.UserIdGroupPairs.length > 0)) {
        pair.toRevoke.push(revoke);
        console.log('SyncSecurityGroupRules: ' + pair.classicSecurityGroup.GroupId + '-->' + pair.vpcSecurityGroup.GroupId + ': REVOKE ' + JSON.stringify(revoke));
    }
}

// For an IpPermission structure to be accepted by EC2.Authorize/
// RevokeSecurityGroupIngress, it needs not have empty arrays.
function _cleanupIpPermission(ipPermission) {
    if (0 == ipPermission.IpRanges.length) {
        delete ipPermission.IpRanges;
    }
    if (0 == ipPermission.UserIdGroupPairs.length) {
        delete ipPermission.UserIdGroupPairs;
    }
}

// Preserve ports/protocol but no permissions
function _copyToBlankPermission(ipPermission) {
    return {
        FromPort: ipPermission.FromPort,
        ToPort: ipPermission.ToPort,
        IpProtocol: ipPermission.IpProtocol,
        IpRanges: [],
        UserIdGroupPairs: []
    };
}


// Some enhancements on Map to make it useful here

Map.fromSecurityGroupRuleValues = function(arr) {
    return new Map(arr.map(function(o) {
        var key = (o.CidrIp || o.GroupId) + ":" + o.IpProtocol + ":" + o.FromPort + ":" + o.ToPort;
        return [ key, o ];
    }));
};

Map.prototype.minusValues = function(other) {
    return Array.from(this.entries()).filter(function(e) {
        return !other.has(e[0]);
    }).map(function(e) { return e[1]; });
}

Map.prototype.intersectValues = function(other) {
    return Array.from(this.entries()).filter(function(e) {
        return other.has(e[0]);
    }).map(function(e) { return [ e[1], other.get(e[0]) ]; });
}


