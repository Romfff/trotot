export class PaginatedResource<T> {
 constructor(public readonly data:T,public readonly meta:{page:number;limit:number;total:number;totalPages:number}){}
}
