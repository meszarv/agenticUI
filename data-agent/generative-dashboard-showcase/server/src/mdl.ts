import axios from 'axios';
import { WrenError } from './wren.js';

type GetMdlResponse = {
  data?: {
    getMDL?: {
      hash?: string;
      mdl?: string | null;
    } | null;
  };
  errors?: Array<{ message?: string }>;
};

const GET_MDL_QUERY = `
  query GetMDL($hash: String!) {
    getMDL(hash: $hash) {
      hash
      mdl
    }
  }
`;

export const fetchMdlFromWrenApi = async (input: {
  graphqlUrl: string;
  hash: string;
}) => {
  const graphqlUrl = input.graphqlUrl.trim();
  const hash = input.hash.trim();

  if (!graphqlUrl) {
    throw new WrenError('Wren UI GraphQL URL is missing');
  }
  if (!hash) {
    throw new WrenError('MDL hash is missing');
  }

  try {
    const res = await axios.post<GetMdlResponse>(
      graphqlUrl,
      {
        query: GET_MDL_QUERY,
        variables: { hash },
      },
      {
        headers: { 'Content-Type': 'application/json' },
        timeout: 60000,
      },
    );

    if (res.data.errors?.length) {
      throw new WrenError(
        `Wren UI GraphQL returned errors: ${res.data.errors
          .map((item) => item.message || 'Unknown error')
          .join('; ')}`,
      );
    }

    const encoded = res.data.data?.getMDL?.mdl;
    if (!encoded) {
      throw new WrenError(
        `No MDL returned for hash "${hash}". Make sure this hash exists in deploy_log.`,
      );
    }

    const decoded = Buffer.from(encoded, 'base64').toString('utf8');
    if (!decoded.trim()) {
      throw new WrenError(`Decoded MDL is empty for hash "${hash}"`);
    }

    return {
      hash,
      mdl: decoded,
      source: graphqlUrl,
    };
  } catch (error) {
    if (error instanceof WrenError) {
      throw error;
    }
    if (error instanceof Error) {
      throw new WrenError(`Failed to fetch MDL from Wren API: ${error.message}`);
    }
    throw new WrenError(`Failed to fetch MDL from Wren API: ${String(error)}`);
  }
};

