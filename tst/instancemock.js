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
