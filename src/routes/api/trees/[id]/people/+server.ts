import type { PersonWriteResponse } from '#lib/shared/api-contracts.js';
import { treeHandler } from '#lib/server/http/handler.js';
import { PersonService } from '#lib/server/services/person-service.js';
import { individualCreateSchema } from '#lib/server/validation/schemas.js';
import { ValidationError } from '#lib/server/domain/errors.js';

export const POST = treeHandler(
	{ failure: 'Failed to create individual', body: individualCreateSchema, status: 201 },
	async ({
		db,
		ctx,
		treeId,
		body: { givenName, surname, sex = 'U', birthDate, birthPlace, deathDate, deathPlace }
	}): Promise<PersonWriteResponse | Response> => {
		if (!givenName?.trim() && !surname?.trim()) {
			throw new ValidationError('Given name or surname is required');
		}
		const { individual, change } = await new PersonService(db).create(
			treeId,
			{
				givenName: givenName?.trim() || null,
				surname: surname?.trim() || null,
				sex,
				birthDate: birthDate?.trim() || null,
				birthPlace: birthPlace?.trim() || null,
				deathDate: deathDate?.trim() || null,
				deathPlace: deathPlace?.trim() || null
			},
			ctx
		);
		return { individual, change };
	}
);
