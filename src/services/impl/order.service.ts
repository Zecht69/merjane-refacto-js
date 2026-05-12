import {type Cradle} from '@fastify/awilix';
import {eq} from 'drizzle-orm';
import {orders} from '@/db/schema.js';
import {type Database} from '@/db/type.js';
import {type ProductService} from './product.service.js';

export class OrderService {
	private readonly db: Database;
	private readonly ps: ProductService;

	public constructor({db, ps}: Pick<Cradle, 'db' | 'ps'>) {
		this.db = db;
		this.ps = ps;
	}

	public async processOrder(orderId: number): Promise<number> {
		const order = await this.db.query.orders.findFirst({
			where: eq(orders.id, orderId),
			with: {
				products: {
					columns: {},
					with: {
						product: true,
					},
				},
			},
		});

		if (!order) {
			throw new Error(`Order ${orderId} not found`);
		}

		for (const {product} of order.products) {
			await this.ps.processProduct(product);
		}

		return order.id;
	}
}