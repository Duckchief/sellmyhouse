import { body } from 'express-validator';
import { SELLER_DOC_TYPES } from './seller.types';

export const uploadSellerDocumentValidator = [
  body('docType')
    .isString()
    .isIn([...SELLER_DOC_TYPES])
    .withMessage(`docType must be one of: ${SELLER_DOC_TYPES.join(', ')}`),
];
