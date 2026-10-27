# Reboot — rewards (R8, planned)

The reward system is separate from Classic. Classic shop and candy data are original and stay untouched.

## Model

The model has three parts:

- `RewardDefinition`: id, kind and a reference to the item.
  - **Kinds:** outfit, accessory, decoration, pose, Miifoto effect, title, badge.
  - **Reboot outfits** are new items kept apart from the original catalogue.
- `RewardGrant`: who received what, from where (game, event or admin), and when. Grants are issued by the server in
  R10, and locally by the minigame and event engines before that.
- `RewardInventory`: the list of grants, plus derived ownership.

## Currency

There is **no currency** for now. Whether to add one is a separate, later decision. There are never real-money
purchases.
