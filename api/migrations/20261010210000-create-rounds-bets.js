/** @type {import('sequelize-cli').Migration} */
export default {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("rounds", {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      room_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: "rooms", key: "id" },
        onDelete: "CASCADE",
      },
      seq: { type: Sequelize.INTEGER, allowNull: false },
      state: {
        type: Sequelize.ENUM(
          "ESPERANDO",
          "CUENTA_REGRESIVA",
          "PAUSADA",
          "CERRADA",
          "GIRANDO",
          "LIQUIDADA",
        ),
        allowNull: false,
        defaultValue: "ESPERANDO",
      },
      pool_red_centimos: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      pool_blue_centimos: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      countdown_ends_at: { type: Sequelize.DATE, allowNull: true },
      countdown_remaining_ms: { type: Sequelize.INTEGER, allowNull: true },
      max_ends_at: { type: Sequelize.DATE, allowNull: true },
      max_expired: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      girando_ends_at: { type: Sequelize.DATE, allowNull: true },
      seed: { type: Sequelize.TEXT, allowNull: true },
      seed_hash: { type: Sequelize.TEXT, allowNull: false },
      result_slot_id: { type: Sequelize.UUID, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex("rounds", ["room_id", "state"]);
    await queryInterface.sequelize.query(
      `CREATE UNIQUE INDEX rounds_one_open_per_room ON rounds (room_id)
       WHERE state IN ('ESPERANDO', 'CUENTA_REGRESIVA', 'PAUSADA');`,
    );
    await queryInterface.addConstraint("rounds", {
      fields: ["room_id", "seq"],
      type: "unique",
      name: "rounds_room_seq_unique",
    });

    await queryInterface.createTable("bets", {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      round_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: "rounds", key: "id" },
        onDelete: "CASCADE",
      },
      seq: { type: Sequelize.INTEGER, allowNull: false },
      side: { type: Sequelize.ENUM("red", "blue"), allowNull: false },
      amount_centimos: { type: Sequelize.INTEGER, allowNull: false },
      status: { type: Sequelize.ENUM("QUEUED", "POOL"), allowNull: false, defaultValue: "QUEUED" },
      parent_bet_id: { type: Sequelize.UUID, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex("bets", ["round_id", "status", "seq"]);
  },

  async down(queryInterface) {
    await queryInterface.dropTable("bets");
    await queryInterface.dropTable("rounds");
    for (const type of [
      "enum_rounds_state",
      "enum_bets_side",
      "enum_bets_status",
    ]) {
      await queryInterface.sequelize.query(`DROP TYPE IF EXISTS "${type}";`);
    }
  },
};
