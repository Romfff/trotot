// Owner-approved D-S5-05/06/07; deletion takes precedence over status.
export function chatPolicy(property: {status:string;deletedAt:Date|null}) {
  if(property.deletedAt) return {canStart:false,canSend:false,reason:'Tin đã bị gỡ hoặc xóa; cuộc trò chuyện chỉ đọc.'};
  if(property.status==='PUBLISHED') return {canStart:true,canSend:true,reason:null};
  if(property.status==='HIDDEN') return {canStart:false,canSend:true,reason:null};
  if(property.status==='EXPIRED') return {canStart:false,canSend:true,reason:null};
  return {canStart:false,canSend:false,reason:property.status==='REJECTED'?'Tin bị từ chối; cuộc trò chuyện chỉ đọc.':'Tin chưa công khai; cuộc trò chuyện chỉ đọc.'};
}
