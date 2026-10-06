import { Team, User } from "@server/models";
import { buildUser } from "@server/test/factories";
import { cleanBetweenTests } from "@server/test/cleanup";
import { getTestServer } from "@server/test/support";

const server = getTestServer();

cleanBetweenTests();

describe("#users.update (integration)", () => {
  it("should persist the new name in Postgres", async () => {
    const user = await buildUser({ name: "Before" });

    const res = await server.post("/api/users.update", user, {
      body: { name: "After" },
    });
    const body = await res.json();

    expect(res.status).toEqual(200);
    expect(body.data.name).toEqual("After");

    const persisted = await User.findByPk(user.id, { rejectOnEmpty: true });
    expect(persisted.name).toEqual("After");
  });

  it("should start each test with an empty database", async () => {
    expect(await User.count()).toEqual(0);
    expect(await Team.count()).toEqual(0);

    await buildUser();

    expect(await User.count()).toEqual(1);
    expect(await Team.count()).toEqual(1);
  });
});
