/** Migración inicial: tabla users (admin y cajeros). */

export async function up(queryInterface, Sequelize) {
  await queryInterface.createTable("users", {
    id: {
      type: Sequelize.UUID,
      defaultValue: Sequelize.UUIDV4,
      primaryKey: true,
    },
    role: {
      type: Sequelize.STRING(16),
      allowNull: false,
    },
    username: {
      type: Sequelize.STRING(64),
      allowNull: false,
      unique: true,
    },
    name: {
      type: Sequelize.STRING(128),
      allowNull: false,
    },
    credential_hash: {
      type: Sequelize.STRING(256),
      allowNull: false,
    },
    active: {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
    created_at: {
      type: Sequelize.DATE,
      allowNull: false,
    },
    updated_at: {
      type: Sequelize.DATE,
      allowNull: false,
    },
  });
}

export async function down(queryInterface) {
  await queryInterface.dropTable("users");
}
