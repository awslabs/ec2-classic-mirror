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

var SgMock = require('./sgmock.js');
var InstanceMock = require('./instancemock.js');

function filterByTagKeys(securityGroups, tagKeys) {
    return securityGroups.filter(function(securityGroup) {
        var foundTag = false;
        for (var i = 0; !foundTag && (i < tagKeys.length); i++) {
            for (var j = 0; !foundTag && (j < securityGroup.Tags.length); j++) {
                foundTag = (securityGroup.Tags[j].Key == tagKeys[i]);
            }
        }
        return foundTag;
    });
}

module.exports = function Ec2Mock() {
    this.securityGroups = [];
    this.nextCreateSecurityGroupId = 0;

    this.instances = [];

    var findInstance = function(instanceId, instances) {
        var instance = undefined;
        for (var i = 0; !instance && (i < instances.length); i++) {
            if (instances[i].InstanceId == instanceId) {
                instance = instances[i];
            }
        }
        return instance;
    };

    var findSecurityGroup = function(resourceId, securityGroups) {
        var resource = undefined;
        for (var i = 0; i < securityGroups.length; i++) {
            if (securityGroups[i].GroupId == resourceId) {
                resource = securityGroups[i];
                break;
            }
        }
        return resource;
    };

    this.describeSecurityGroups = function(params, callback) {
        console.log('MOCK describeSecurityGroups REQUEST: ' + JSON.stringify(params));
        var sgs = this.securityGroups;
        Object.keys(params).forEach(function(paramKey) {
            if (paramKey == 'GroupIds') {
                var filtered = [];
                for (var i = 0; i < params.GroupIds.length; i++) {
                    var foundSg = undefined;
                    for (var j = 0; j < sgs.length; j++) {
                        if (params.GroupIds[i] == sgs[j].GroupId) {
                            foundSg = sgs[j];
                            break;
                        }
                    }
                    if (foundSg) {
                        filtered.push(foundSg);
                    } else {
                        callback('Invalid GroupId ' + params.GroupIds[i]);
                        return;
                    }
                }
                sgs = filtered;
            } else if (paramKey == 'Filters') {
                for (var i = 0; i < params.Filters.length; i++) {
                    var filter = params.Filters[i];
                    if (filter.Name == 'tag-key') {
                        var filtered = filterByTagKeys(sgs, filter.Values);
                        sgs = filtered;
                    } else if (filter.Name == 'vpc-id') {
                        sgs = sgs.filter(function(sg) {
                            return (filter.Values.indexOf(sg.VpcId) >= 0);
                        });
                    } else if (filter.name = 'group-name') {
                        sgs = sgs.filter(function(sg) {
                            return (filter.Values.indexOf(sg.GroupName) >= 0);
                        });
                    } else {
                        callback('Unsupported filter ' + filter.Name);
                        return;
                    }
                }
            } else {
                callback('No mock for ' + JSON.stringify(params));
                return;
            }
        });

        var response = { SecurityGroups: sgs };
        console.log('MOCK describeSecurityGroups RESPONSE: ' + JSON.stringify(response));
        callback(null, response);
    };

    this.createSecurityGroup = function(params, callback) {
        console.log('MOCK createSecurityGroup REQUEST: ' + JSON.stringify(params));

        // Can never create a Security Group named 'default'
        if (params.GroupName == 'default') {
            callback('InvalidParameterValue: Cannot use reserved security group name: default');
            return;
        }

        // If the VPC (or Classic) already has a Security Group with this
        // name, you can't create it.
        if (this.securityGroups.some(function(sg) { return ((sg.VpcId == params.VpcId) && (sg.GroupName == params.GroupName)) })) {
            callback('A client error (InvalidGroup.Duplicate) occurred when calling the CreateSecurityGroup operation: The security group \'' + params.GroupName + '\' already exists for VPC \'' + params.VpcId + '\'');
            return;
        }

        var groupId = 'sg-MOCKCREATED-' + this.nextCreateSecurityGroupId++;
        var sg = new SgMock(groupId)
            .withGroupName(params.GroupName)
            .withDescription(params.Description)
            .withVpcId(params.VpcId);
        this.securityGroups.push(sg);
        var response = { GroupId: groupId };
        console.log('MOCK createSecurityGroup RESPONSE: ' + JSON.stringify(response));
        callback(null, response);
    };

    this.deleteSecurityGroup = function(params, callback) {
        console.log('MOCK deleteSecurityGroup REQUEST: ' + JSON.stringify(params));
        var sgs = [];
        var found = false;
        for (var i = 0; i < this.securityGroups.length; i++) {
            if (this.securityGroups[i].GroupId == params.GroupId) {
                if (this.securityGroups[i].GroupName == 'default') {
                    callback('A client error (CannotDelete) occurred when calling the DeleteSecurityGroup operation: the specified group: "' + this.securityGroups[i].GroupId + '" name: "default" cannot be deleted by a user');
                    return;
                }
                found = true;
            } else {
                sgs.push(this.securityGroups[i]);
            }
        }
        this.securityGroups = sgs;
        if (found) {
            console.log('MOCK deleteSecurityGroup RESPONSE: ok');
            callback(null, {});
        } else {
            callback(params.GroupId + ' not found');
        }
    };

    var findIpPermissionIndex = function(sg, protocol, fromPort, toPort) {
        var i = 0;
        while (i < sg.IpPermissions.length) {
            var ipPermission = sg.IpPermissions[i];
            if ((ipPermission.IpProtocol == protocol) && (ipPermission.FromPort == fromPort) && (ipPermission.ToPort == toPort)) {
                break;
            }
            i++;
        }
        if (i == sg.IpPermissions.length) {
            i = -1;
        }
        return i;
    };

    var findPermissionCidrIp = function(ipPermission, cidrIp) {
        for (var i = 0; i < ipPermission.IpRanges.length; i++) {
            if (ipPermission.IpRanges[i].CidrIp == cidrIp) {
                return i;
            }
        }
        return -1;
    };

    var findPermissionUserIdGroupPairIndex = function(ipPermission, userIdGroupPair) {
        var i = 0;
        while (i < ipPermission.UserIdGroupPairs.length) {
            var p = ipPermission.UserIdGroupPairs[i];
            if ((p.UserId == userIdGroupPair.UserId) && (p.GroupId == userIdGroupPair.GroupId)) {
                break;
            }
            i++;
        }
        if (i == ipPermission.UserIdGroupPairs.length) {
            i = -1;
        }
        return i;
    };

    var validateAuthorizeRevokeParams = function(params) {
        params.IpPermissions.forEach(function(ipPermission) {
            if (ipPermission.IpRanges) {
                if (0 == ipPermission.IpRanges.length) {
                    return false;
                }
                ipPermission.IpRanges.forEach(function(ipr) {
                    if (!ipr.CidrIp) {
                        return false;
                    }
                });
            }
            if (ipPermission.UserIdGroupPairs) {
                if (0 == ipPermission.UserIdGroupPairs.length) {
                    return false;
                }
                ipPermission.UserIdGroupPairs.forEach(function(pair) {
                    if (!pair.GroupId) {
                        return false;
                    }
                });
            }
        });
        return true;
    };

    this.authorizeSecurityGroupIngress = function(params, callback) {
        console.log('MOCK authorizeSecurityGroupIngress REQUEST: ' + JSON.stringify(params));
        if (!validateAuthorizeRevokeParams(params)) {
            console.log('MOCK Invalid params ' + JSON.stringify(params));
            callback('Invalid parameters');
            return;
        }
        var sg = findSecurityGroup(params.GroupId, this.securityGroups);
        if (sg) {
            params.IpPermissions.forEach(function(ipPermission) {
                var i = findIpPermissionIndex(sg, ipPermission.IpProtocol, ipPermission.FromPort, ipPermission.ToPort);
                if (i < 0) {
                    sg.IpPermissions.push({
                        PrefixListIds: [],
                        FromPort: ipPermission.FromPort,
                        IpRanges: [],
                        ToPort: ipPermission.ToPort,
                        IpProtocol: ipPermission.IpProtocol,
                        UserIdGroupPairs: []
                    });
                    i = sg.IpPermissions.length - 1;
                }
                var destIpPermission = sg.IpPermissions[i];

                ipPermission.IpRanges && ipPermission.IpRanges.forEach(function(ipRange) {
                    var ipRangeIndex = findPermissionCidrIp(destIpPermission, ipRange.CidrIp);
                    if (ipRangeIndex < 0) {
                        destIpPermission.IpRanges.push(ipRange);
                    }
                });

                ipPermission.UserIdGroupPairs && ipPermission.UserIdGroupPairs.forEach(function(pair) {
                    var pairIndex = findPermissionUserIdGroupPairIndex(destIpPermission, pair);
                    if (pairIndex < 0) {
                        destIpPermission.UserIdGroupPairs.push(pair);
                    }
                });
                console.log('MOCK authorizeSecurityGroupIngress permission ' + JSON.stringify(destIpPermission));
            });
            console.log('MOCK authorizeSecurityGroupIngress RESPONSE: OK ' + JSON.stringify(sg));
            callback(null, {});
        } else {
            callback(params.GroupId + ' not found');
        }
    };

    this.revokeSecurityGroupIngress = function(params, callback) {
        console.log('MOCK revokeSecurityGroupIngress REQUEST: ' + JSON.stringify(params));
        if (!validateAuthorizeRevokeParams(params)) {
            console.log('MOCK Invalid params ' + JSON.stringify(params));
            callback('Invalid parameters');
            return;
        }
        var sg = findSecurityGroup(params.GroupId, this.securityGroups);
        if (sg) {
            params.IpPermissions.forEach(function(ipPermission) {
                var i = findIpPermissionIndex(sg, ipPermission.IpProtocol, ipPermission.FromPort, ipPermission.ToPort);
                if (i < 0) {
                    callback('Permission ' + JSON.stringify(ipPermission) + ' not found on ' + params.GroupId);
                    return;
                }
                var destIpPermission = sg.IpPermissions[i];
                console.log('MOCK revoking ' + JSON.stringify(ipPermission));

                ipPermission.IpRanges && ipPermission.IpRanges.forEach(function(ipRange) {
                    var ipRangeIndex = findPermissionCidrIp(destIpPermission, ipRange.CidrIp);
                    if (ipRangeIndex >= 0) {
                        destIpPermission.IpRanges.splice(ipRangeIndex, 1);
                    } else {
                        callback('IP range ' + ipRange + ' not found in ' + JSON.stringify(destIpPermission));
                        return;
                    }
                });

                ipPermission.UserIdGroupPairs && ipPermission.UserIdGroupPairs.forEach(function(pair) {
                    var pairIndex = findPermissionUserIdGroupPairIndex(destIpPermission, pair);
                    if (pairIndex >= 0) {
                        destIpPermission.UserIdGroupPairs.splice(pairIndex, 1);
                    } else {
                        callback('UserIdGroupPair ' + JSON.stringify(pair) + ' not found in ' + JSON.stringify(destIpPermission));
                        return;
                    }
                });
            });

            // Clean out any permissions that are now empty
            sg.IpPermissions = sg.IpPermissions.filter(function(ipPermission) {
                return ((ipPermission.IpRanges.length > 0) || (ipPermission.UserIdGroupPairs.length > 0));
            });
            console.log('MOCK revokeSecurityGroupIngress RESPONSE OK ' + JSON.stringify(sg));
            callback(null, {});
        } else {
            callback(params.GroupId + ' not found');
            return;
        }

     };

    var findTag = function(resource, tagKey) {
        var tag = undefined;
        for (var i = 0; i < resource.Tags.length; i++) {
            if (resource.Tags[i].Key == tagKey) {
                tag = resource.Tags[i];
                break;
            }
        }
        return tag;
    };

    this.createTags = function(params, callback) {
        console.log('MOCK createTags REQUEST: ' + JSON.stringify(params));
        var securityGroups = this.securityGroups;
        var instances = this.instances;
        params.Resources.forEach(function(resourceId) {
            var resource = findSecurityGroup(resourceId, securityGroups) || findInstance(resourceId, instances);
            if (resource) {
                params.Tags.forEach(function(tagPair) {
                    var tag = findTag(resource, tagPair.Key);
                    if (!tag) {
                        tag = { Key: tagPair.Key };
                        resource.Tags.push(tag);
                    }
                    tag.Value = tagPair.Value;
                });
            } else {
                callback('Unrecognized resource ' + resourceId);
                return;
            }
        });
        console.log('MOCK createTags RESPONSE: ok');
        callback(null, {});
    };

    this.deleteTags = function(params, callback) {
        console.log('MOCK deleteTags REQUEST: ' + JSON.stringify(params));
        var securityGroups = this.securityGroups;
        var instances = this.instances;
        params.Resources.forEach(function(resourceId) {
            var resource = findSecurityGroup(resourceId, securityGroups) || findInstance(resourceId, instances);
            if (resource) {
                var newTags = [];
                resource.Tags.forEach(function(tag) {
                    var found = false;
                    for (var i = 0; i < params.Tags.length; i++) {
                        if (tag.Key == params.Tags[i].Key) {
                            if (!params.Tags[i].Value || (tag.Value == params.Tags[i].Value)) {
                                console.log('MOCK deleteTags found matching tag ' + JSON.stringify(params.Tags[i]) + ' on ' + JSON.stringify(resource));
                                found = true;
                                break;
                            }
                            break;
                        }
                    }
                    if (!found) {
                        newTags.push(tag);
                    }
                });
                resource.Tags = newTags;
            } else {
                callback('Unrecognized resource ' + resourceId);
            }
        });
        console.log('MOCK deleteTags RESPONSE: ok');
        callback(null, {});
    };

    var anyCommonElements = function(arr1, arr2) {
        for (var i1 = 0; i1 < arr1.length; i1++) {
            var v1 = arr1[i1];
            for (var i2 = 0; i2 < arr2.length; i2++) {
                var v2 = arr2[i2];
                if (v1 == v2) {
                    return true;
                }
            }
        }
        return false;
    }

    this.describeInstances = function(params, callback) {
        console.log('MOCK describeInstances REQUEST: ' + JSON.stringify(params));

        // Include each instance only if it passes all our filters
        var err = undefined;
        var instancesFiltered = this.instances.filter(function(instance) {
            for (var i = 0; i < params.Filters.length; i++) {
                var filter = params.Filters[i];
                if (filter.Name == 'group-id') {
                    var instanceGroupIds = instance.Groups.map(function(group) {
                        return group.GroupId;
                    });

                    // The instance passes the filter only if it is a
                    // member of at least one Security Group in the
                    // filter values.
                    if (!anyCommonElements(instanceGroupIds, filter.Values)) {
                        return false;
                    }
                } else if (filter.Name = 'instance-state-name') {
                    var matchesFilter = false;
                    for (var i = 0; !matchesFilter && (i < filter.Values.length); i++) {
                        if (instance.State.Name == filter.Values[i]) {
                            matchesFilter = true;
                        }
                    }
                    if (!matchesFilter) return false;
                } else {
                    err = err || 'MOCK describeInstances unsupported filter ' + filter.Name;
                    return false;
                }
            }
            return true;
        });
        if (err) {
            callback(err);
            return;
        }

        var responseInstances = instancesFiltered.map(function(instance) {
            return instance.describe();
        });
        var response = { Reservations: [ { Instances: responseInstances } ] };
        console.log('MOCK describeInstances RESPONSE: ' + JSON.stringify(response));
        callback(null, response);
    };

    this.describeClassicLinkInstances = function(params, callback) {
        console.log('MOCK describeClassicLinkInstances REQUEST: ' + JSON.stringify(params));

        // Include each instance only if it passes all our filters
        var err = undefined;
        var instancesFiltered = this.instances.filter(function(instance) {
            for (var i = 0; i < params.Filters.length; i++) {
                var filter = params.Filters[i];
                if (filter.Name == 'group-id') {
                    var linkedGroupIds = [];
                    if (instance.ClassicLink) {
                        linkedGroupIds = instance.ClassicLink.Groups.map(function(group) {
                            return group.GroupId;
                        });

                        // The instance passes the filter only if it is
                        // linke to at least one of the Security Groups
                        // in the filter values.
                        if (!anyCommonElements(linkedGroupIds, filter.Values)) {
                            return false;
                        }
                    } else {
                        return false;
                    }
                } else {
                    err = err || 'MOCK describeClassicLinkInstances unsupported filter ' + filter.Name;
                    return false;
                }
            }
            return true;
        });
        if (err) {
            callback(err);
            return;
        }

        var responseInstances = instancesFiltered.map(function(instance) {
            return instance.describeClassicLink();
        });

        // Poor man's pagination: 5 per page
        var pageStart = 0;
        if (params.NextToken) {
            pageStart = params.NextToken;
        }
        var pageEnd = pageStart + 5;
        var responseInstancesPage = responseInstances.slice(pageStart, pageEnd);

        var response = { Instances: responseInstancesPage };
        if (pageEnd < responseInstances.length) {
            response.NextToken = pageEnd;
        }
        console.log('MOCK describeClassicLinkInstances RESPONSE: ' + JSON.stringify(response));
        callback(null, response);
    };

    this.attachClassicLinkVpc = function(params, callback) {
        console.log('MOCK attachClassicLinkVpc REQUEST: ' + JSON.stringify(params));
        var instance = findInstance(params.InstanceId, this.instances);
        if (!instance) {
            callback('MOCK attachClassicLinkVpc unknown instance ' + params.InstanceId);
            return;
        }

        if (params.Groups.length == 0) {
            callback('MOCK attachClassicLinkVpc: must specify at least one Security Groups in the VPC');
            return;
        }

        if (instance.State.Name != 'running') {
            callback('MOCK attachClassicLinkVpc: instance ' + instance.InstanceId + ' is in state ' + instance.State.Name);
            return;
        }

        if (instance.ClassicLink) {
            callback('MOCK attachClassicLinkVpc error: ' + params.InstanceId + ' already linked to ' + JSON.stringify(instance.ClassicLink));
            return;
        }

        instance.withClassicLink(params.VpcId, params.Groups);
        console.log('MOCK attachClassicLinkVpc RESPONSE ok');
        callback(null, {Return: true});
    };

    this.detachClassicLinkVpc = function(params, callback) {
        console.log('MOCK detachClassicLinkVpc REQUEST: ' + JSON.stringify(params));
        var instance = findInstance(params.InstanceId, this.instances);
        if (!instance) {
            callback('MOCK detachClassicLinkVpc unknown instance ' + params.InstanceId);
            return;
        }

        if (!instance.ClassicLink) {
            callback('MOCK detachClassicLinkVpc error: ' + params.InstanceId + ' not classic linked');
            return;
        }

        if (instance.ClassicLink.VpcId != params.VpcId) {
            callback('MOCK detachClassicLinkVpc error: ' + params.InstanceId + ' linked to ' + instance.ClassicLink.VpcId + ' which does not match ' + params.VpcId + ' in the request');
            return;
        }

        instance.unClassicLink();
        console.log('MOCK detachClassicLinkVpc RESPONSE ok');
        callback(null, {Return: true});
    };

};
