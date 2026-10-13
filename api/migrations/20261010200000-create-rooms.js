/** Salas y sus casillas (multiplicadores y pesos). */

export async function up(queryInterface, Sequelize) {
  await queryInterface.createTable("rooms", {
    id: {
      type: Sequelize.UUID,
      defaultValue: Sequelize.UUIDV4,
      primaryKey: true,
    },
    code: {
      type: Sequelize.STRING(8),
      allowNull: false,
      unique: true,
    },
    name: {
      type: Sequelize.STRING(128),
      allowNull: false,
    },
    whatsapp: {
      type: Sequelize.STRING(32),
      allowNull: true,
    },
    yape_qr: {
      type: Sequelize.TEXT,
      allowNull: true,
    },
    plin_qr: {
      type: Sequelize.TEXT,
      allowNull: true,
    },
    min_bet_centimos: {
      type: Sequelize.INTEGER,
      allowNull: false,
      defaultValue: 100,
    },
    max_bet_centimos: {
      type: Sequelize.INTEGER,
      allowNull: false,
      defaultValue: 5000,
    },
    cashier_id: {
      type: Sequelize.UUID,
      allowNull: true,
      unique: true,
      references: { model: "users", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "SET NULL",
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

  await queryInterface.createTable("room_slots", {
    id: {
      type: Sequelize.UUID,
      defaultValue: Sequelize.UUIDV4,
      primaryKey: true,
    },
    room_id: {
      type: Sequelize.UUID,
      allowNull: false,
      references: { model: "rooms", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "CASCADE",
    },
    side: {
      type: Sequelize.STRING(8),
      allowNull: false,
    },
    multiplier: {
      type: Sequelize.INTEGER,
      allowNull: false,
    },
    weight: {
      type: Sequelize.INTEGER,
      allowNull: false,
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

  await queryInterface.addIndex("room_slots", ["room_id"]);
}

export async function down(queryInterface) {
  await queryInterface.dropTable("room_slots");
  await queryInterface.dropTable("rooms");
}
