"use strict";Object.defineProperty(exports,"__esModule",{value:!0}),exports.ClusterResourceHandler=void 0;const common_1=require("./common"),MAX_CLUSTER_NAME_LEN=100;class ClusterResourceHandler extends common_1.ResourceHandler{constructor(eks,event){super(eks,event),this.newProps=parseProps(this.event.ResourceProperties),this.oldProps=event.RequestType==="Update"?parseProps(event.OldResourceProperties):{}}get clusterName(){if(!this.physicalResourceId)throw new Error("Cannot determine cluster name without physical resource ID");return this.physicalResourceId}async onCreate(){if(console.log("onCreate: creating cluster with options:",JSON.stringify(this.newProps,void 0,2)),!this.newProps.roleArn)throw new Error('"roleArn" is required');const clusterName=this.newProps.name||this.generateClusterName(),resp=await this.eks.createCluster({...this.newProps,name:clusterName});if(!resp.cluster)throw new Error(`Error when trying to create cluster ${clusterName}: CreateCluster returned without cluster information`);return{PhysicalResourceId:resp.cluster.name}}async isCreateComplete(){return this.isActive()}async onDelete(){console.log(`onDelete: deleting cluster ${this.clusterName}`);try{await this.eks.deleteCluster({name:this.clusterName})}catch(e){if(e.code!=="ResourceNotFoundException")throw e;console.log(`cluster ${this.clusterName} not found, idempotently succeeded`)}return{PhysicalResourceId:this.clusterName}}async isDeleteComplete(){console.log(`isDeleteComplete: waiting for cluster ${this.clusterName} to be deleted`);try{const resp=await this.eks.describeCluster({name:this.clusterName});console.log("describeCluster returned:",JSON.stringify(resp,void 0,2))}catch(e){if(e.code==="ResourceNotFoundException")return console.log("received ResourceNotFoundException, this means the cluster has been deleted (or never existed)"),{IsComplete:!0};throw console.log("describeCluster error:",e),e}return{IsComplete:!1}}async onUpdate(){const updates=analyzeUpdate(this.oldProps,this.newProps);if(console.log("onUpdate:",JSON.stringify({updates},void 0,2)),updates.updateEncryption)throw new Error("Cannot update cluster encryption configuration");if(updates.replaceName||updates.replaceRole||updates.replaceVpc){if(this.oldProps.name===this.newProps.name&&this.oldProps.name)throw new Error(`Cannot replace cluster "${this.oldProps.name}" since it has an explicit physical name. Either rename the cluster or remove the "name" configuration`);return this.onCreate()}if(updates.updateVersion){if(!this.newProps.version)throw new Error(`Cannot remove cluster version configuration. Current version is ${this.oldProps.version}`);return this.updateClusterVersion(this.newProps.version)}if(updates.updateLogging||updates.updateAccess){const config={name:this.clusterName,logging:this.newProps.logging};return updates.updateAccess&&(config.resourcesVpcConfig={endpointPrivateAccess:this.newProps.resourcesVpcConfig.endpointPrivateAccess,endpointPublicAccess:this.newProps.resourcesVpcConfig.endpointPublicAccess,publicAccessCidrs:this.newProps.resourcesVpcConfig.publicAccessCidrs}),{EksUpdateId:(await this.eks.updateClusterConfig(config)).update?.id}}}async isUpdateComplete(){return console.log("isUpdateComplete"),this.event.EksUpdateId&&!await this.isEksUpdateComplete(this.event.EksUpdateId)?{IsComplete:!1}:this.isActive()}async updateClusterVersion(newVersion){console.log(`updating cluster version to ${newVersion}`);const cluster=(await this.eks.describeCluster({name:this.clusterName})).cluster;if(cluster?.version===newVersion){console.log(`cluster already at version ${cluster.version}, skipping version update`);return}return{EksUpdateId:(await this.eks.updateClusterVersion({name:this.clusterName,version:newVersion})).update?.id}}async isActive(){console.log("waiting for cluster to become ACTIVE");const resp=await this.eks.describeCluster({name:this.clusterName});console.log("describeCluster result:",JSON.stringify(resp,void 0,2));const cluster=resp.cluster;if(cluster?.status==="FAILED")throw new Error("Cluster is in a FAILED status");return cluster?.status!=="ACTIVE"?{IsComplete:!1}:{IsComplete:!0,Data:{Name:cluster.name,Endpoint:cluster.endpoint,Arn:cluster.arn,CertificateAuthorityData:cluster.certificateAuthority?.data??"",ClusterSecurityGroupId:cluster.resourcesVpcConfig?.clusterSecurityGroupId??"",OpenIdConnectIssuerUrl:cluster.identity?.oidc?.issuer??"",OpenIdConnectIssuer:cluster.identity?.oidc?.issuer?.substring(8)??"",EncryptionConfigKeyArn:cluster.encryptionConfig?.shift()?.provider?.keyArn??""}}}async isEksUpdateComplete(eksUpdateId){this.log({isEksUpdateComplete:eksUpdateId});const describeUpdateResponse=await this.eks.describeUpdate({name:this.clusterName,updateId:eksUpdateId});if(this.log({describeUpdateResponse}),!describeUpdateResponse.update)throw new Error(`unable to describe update with id "${eksUpdateId}"`);switch(describeUpdateResponse.update.status){case"InProgress":return!1;case"Successful":return!0;case"Failed":case"Cancelled":throw new Error(`cluster update id "${eksUpdateId}" failed with errors: ${JSON.stringify(describeUpdateResponse.update.errors)}`);default:throw new Error(`unknown status "${describeUpdateResponse.update.status}" for update id "${eksUpdateId}"`)}}generateClusterName(){const suffix=this.requestId.replace(/-/g,""),offset=MAX_CLUSTER_NAME_LEN-suffix.length-1;return`${this.logicalResourceId.slice(0,offset>0?offset:0)}-${suffix}`}}exports.ClusterResourceHandler=ClusterResourceHandler;function parseProps(props){const parsed=props?.Config??{};return typeof parsed.resourcesVpcConfig?.endpointPrivateAccess=="string"&&(parsed.resourcesVpcConfig.endpointPrivateAccess=parsed.resourcesVpcConfig.endpointPrivateAccess==="true"),typeof parsed.resourcesVpcConfig?.endpointPublicAccess=="string"&&(parsed.resourcesVpcConfig.endpointPublicAccess=parsed.resourcesVpcConfig.endpointPublicAccess==="true"),typeof parsed.logging?.clusterLogging[0].enabled=="string"&&(parsed.logging.clusterLogging[0].enabled=parsed.logging.clusterLogging[0].enabled==="true"),parsed}function analyzeUpdate(oldProps,newProps){console.log("old props: ",JSON.stringify(oldProps)),console.log("new props: ",JSON.stringify(newProps));const newVpcProps=newProps.resourcesVpcConfig||{},oldVpcProps=oldProps.resourcesVpcConfig||{},oldPublicAccessCidrs=new Set(oldVpcProps.publicAccessCidrs??[]),newPublicAccessCidrs=new Set(newVpcProps.publicAccessCidrs??[]),newEnc=newProps.encryptionConfig||{},oldEnc=oldProps.encryptionConfig||{};return{replaceName:newProps.name!==oldProps.name,replaceVpc:JSON.stringify(newVpcProps.subnetIds)!==JSON.stringify(oldVpcProps.subnetIds)||JSON.stringify(newVpcProps.securityGroupIds)!==JSON.stringify(oldVpcProps.securityGroupIds),updateAccess:newVpcProps.endpointPrivateAccess!==oldVpcProps.endpointPrivateAccess||newVpcProps.endpointPublicAccess!==oldVpcProps.endpointPublicAccess||!setsEqual(newPublicAccessCidrs,oldPublicAccessCidrs),replaceRole:newProps.roleArn!==oldProps.roleArn,updateVersion:newProps.version!==oldProps.version,updateEncryption:JSON.stringify(newEnc)!==JSON.stringify(oldEnc),updateLogging:JSON.stringify(newProps.logging)!==JSON.stringify(oldProps.logging)}}function setsEqual(first,second){return first.size===second.size||[...first].every(e=>second.has(e))}
//# sourceMappingURL=cluster.js.map
