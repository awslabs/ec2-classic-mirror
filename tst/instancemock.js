/*
 * Copyright 2016 Amazon.com, Inc. or its affiliates. All Rights Reserved.
 *
 * SPDX-License-Identifier: MIT-0
 */

module.exports = function InstanceMock(id) {
    this.InstanceId = id;
    this.Groups = [];
    this.State = { Code: 16, Name: 'running' };
    this.Tags = [];

    this.withSecurityGroup = function(securityGroup) {
        this.Groups.push({GroupName: securityGroup.GroupName, GroupId: securityGroup.GroupId});
        return this;
    };

    this.withClassicLink = function(vpcId, groupIds) {
        var groups = groupIds.map(function(groupId) {
            return { GroupName: 'Name-' + groupId, GroupId: groupId };
        });
        this.ClassicLink = {VpcId: vpcId, Groups: groups};
        return this;
    };

    this.unClassicLink = function() {
        delete this.ClassicLink;
        return this;
    };

    this.pending = function() {
        this.State.Code = 0;
        this.State.Name = 'pending';
        return this;
    };

    this.terminate = function() {
        this.State.Code = 48;
        this.State.Name = 'terminated';
        return this;
    };

    this.withTag = function(key, value) {
        this.Tags.push({Key: key, Value: value});
        return this;
    };

    this.describe = function() {
        return {
            InstanceId: this.InstanceId,
            State: this.State,
            SecurityGroups: this.Groups
        };
    };

    this.describeClassicLink = function() {
        if (this.ClassicLink) {
            return {
                InstanceId: this.InstanceId,
                VpcId: this.ClassicLink.VpcId,
                Groups: this.ClassicLink.Groups
            };
        } else {
            return undefined;
        }
    };
};
