import dotenv from 'dotenv';
dotenv.config();

import { createApp } from './infra/http/app';
import { logger } from './infra/logger';

const app = createApp();
const port = parseInt(process.env.PORT || '3000', 10);

app.listen(port, () => {
  logger.info(`Server running on port ${port}`);
});
