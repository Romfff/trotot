export type PayoutFields = {hostId:string;reason:string;bankReference:string;evidenceNote:string};
export type PayoutOperation = "create"|"approve"|"cancel"|"confirmPaid";
export function payoutFieldErrors(fields:PayoutFields,action:PayoutOperation) {
  const errors:Partial<Record<keyof PayoutFields,string>>={};
  if(action==="create"&&!/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(fields.hostId.trim()))errors.hostId="Nhập ID Host hợp lệ (UUID).";
  for(const name of (action==="confirmPaid"?["reason","bankReference","evidenceNote"]:["reason"]) as (keyof PayoutFields)[]) {
    const max=name==="bankReference"?200:500;
    if(!fields[name].trim()||fields[name].trim().length>max)errors[name]=`Nhập từ 1 đến ${max} ký tự.`;
  }
  return errors;
}
