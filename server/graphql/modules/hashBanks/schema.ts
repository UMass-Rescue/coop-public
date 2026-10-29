export const typeDefs = /* GraphQL */ `
  type ExchangeInfo {
    api: String!
    enabled: Boolean!
    has_auth: Boolean!
    has_own_credentials: Boolean!
    error: String
    last_fetch_succeeded: Boolean
    last_fetch_time: String
    up_to_date: Boolean
    fetched_items: Int
    is_fetching: Boolean
  }

  """
  Which HMA deployment holds a bank. DEFAULT is the standard HMA (PDQ images,
  MD5 video); CLIP is the optional CLIP instance. Fixed when the bank is created.
  """
  enum HashBankHmaInstance {
    DEFAULT
    CLIP
  }

  type HashBank {
    id: ID!
    name: String!
    description: String
    hma_name: String!
    enabled_ratio: Float!
    hma_instance: HashBankHmaInstance!
    org_id: String!
    exchange: ExchangeInfo
  }

  type ExchangeFieldDescriptor {
    name: String!
    type: String!
    required: Boolean!
    default: JSON
    help: String
    choices: [String!]
  }

  type ExchangeSchemaSection {
    fields: [ExchangeFieldDescriptor!]!
  }

  type ExchangeApiSchema {
    config_schema: ExchangeSchemaSection!
    credentials_schema: ExchangeSchemaSection
  }

  type ExchangeApiInfo {
    name: String!
    supports_auth: Boolean!
    has_auth: Boolean! @deprecated
  }

  type ExchangeCredentialStatus {
    has_credentials: Boolean!
    has_own_credentials: Boolean!
  }

  input ExchangeConfigInput {
    api_name: String!
    config_json: String!
    credentials_json: String
  }

  input CreateHashBankInput {
    name: String!
    description: String
    enabled_ratio: Float!
    hma_instance: HashBankHmaInstance = DEFAULT
    exchange: ExchangeConfigInput
  }

  input UpdateHashBankInput {
    id: ID!
    name: String
    description: String
    enabled_ratio: Float
  }

  type MutateHashBankSuccessResponse {
    data: HashBank!
    warning: String
  }

  type MatchingBankNameExistsError implements Error {
    title: String!
    status: Int!
    type: [String!]!
    pointer: String
    detail: String
    requestId: String
  }

  union MutateHashBankResponse =
    | MutateHashBankSuccessResponse
    | MatchingBankNameExistsError

  type Query {
    hashBanks: [HashBank!]!
    hashBank(name: String!): HashBank
    hashBankById(id: ID!): HashBank
    """
    The HMA instances the signed-in org can create banks on. CLIP is listed only
    when the deployment has the CLIP instance and the org has turned CLIP on.
    """
    hashBankHmaInstances: [HashBankHmaInstance!]!
    exchangeApis: [ExchangeApiInfo!]!
    exchangeApiSchema(apiName: String!): ExchangeApiSchema
  }

  type Mutation {
    createHashBank(input: CreateHashBankInput!): MutateHashBankResponse!
    updateHashBank(input: UpdateHashBankInput!): MutateHashBankResponse!
    deleteHashBank(id: ID!): Boolean!
    updateExchangeCredentials(
      apiName: String!
      credentialsJson: String!
    ): Boolean! @deprecated
    updateHashBankExchangeCredentials(
      bankId: ID!
      credentialsJson: String!
    ): ExchangeCredentialStatus!
  }
`;
